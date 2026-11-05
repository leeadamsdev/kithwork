import { openMessage, parseEncryptionKey } from "@kithwork/email/crypto";
import type { EmailMessage } from "@kithwork/email";
import type { OutboxDeliveryOutcome } from "@kithwork/email/worker";
import type { createOutboxStore } from "./store.js";

export function createOutboxDelivery({
  store,
  encryptionKey,
  deliver,
  onEvent,
}: {
  store: ReturnType<typeof createOutboxStore>;
  encryptionKey: string;
  deliver: (message: EmailMessage, id: string) => Promise<void>;
  onEvent: (event: {
    outcome: OutboxDeliveryOutcome;
    outboxId: string;
    organisationId?: string;
    invitationId?: string;
    requestId?: string;
    attempt?: number;
    errorCode?: string;
  }) => void;
}) {
  const key = parseEncryptionKey(encryptionKey);
  return async (id: string): Promise<OutboxDeliveryOutcome> => {
    try {
      const claim = await store.claimDelivery(id);
      if (claim.kind === "busy") throw new Error("Outbox delivery is busy");
      if (claim.kind !== "deliver") {
        onEvent({ outcome: claim.kind, outboxId: id });
        return claim.kind;
      }
      const fields = {
        outboxId: id,
        organisationId: claim.organisationId,
        invitationId: claim.invitationId,
        ...(claim.requestId ? { requestId: claim.requestId } : {}),
        attempt: claim.attempt,
      };
      let message: EmailMessage;
      try {
        message = openMessage(claim.payload, key, id);
        if (
          message.kind !== "invitation" ||
          message.to !== claim.email ||
          message.expiresAt !== claim.expiresAt
        )
          throw new Error("Invalid invitation email");
      } catch {
        await store.deliveryFailed(claim, "invalid_payload", true);
        onEvent({ outcome: "failed", errorCode: "invalid_payload", ...fields });
        return "failed";
      }
      const failure = await deliver(message, id).then(
        () => undefined,
        (error: unknown) => ({
          permanent:
            error instanceof Error &&
            "responseCode" in error &&
            typeof error.responseCode === "number" &&
            error.responseCode >= 500 &&
            error.responseCode <= 599,
        }),
      );
      if (failure) {
        const code = failure.permanent ? "smtp_rejected" : "smtp_transient";
        const terminal = await store.deliveryFailed(
          claim,
          code,
          failure.permanent,
        );
        onEvent({ outcome: "failed", errorCode: code, ...fields });
        if (terminal) return "failed";
        throw new Error("Outbox email delivery failed");
      }
      await store.delivered(claim);
      onEvent({ outcome: "delivered", ...fields });
      return "delivered";
    } catch {
      // Database and SMTP errors can contain SQL, addresses or bearer links.
      throw new Error("Outbox email delivery failed");
    }
  };
}
