import { UnrecoverableError, type Job } from "bullmq";
import type { EmailWorkerOptions } from "./options.js";
import {
  outboxReferenceSchema,
  type OutboxDeliveryOutcome,
} from "./outbox-reference.js";
import { deliverSealedEmail } from "./sealed-delivery.js";

export function createEmailProcessor(options: EmailWorkerOptions, key: Buffer) {
  return async (job: Job<unknown>) => {
    if (job.name === "deliver-outbox") {
      const reference = outboxReferenceSchema.safeParse(job.data);
      if (
        !reference.success ||
        reference.data.outboxId !== job.id ||
        !options.deliverOutboxEmail
      ) {
        await job.updateData({});
        throw new UnrecoverableError("Invalid outbox email reference");
      }
      const fields = {
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        ...(reference.data.requestId
          ? { requestId: reference.data.requestId }
          : {}),
      };
      let outcome: OutboxDeliveryOutcome;
      try {
        outcome = await options.deliverOutboxEmail(reference.data.outboxId);
      } catch {
        options.onEvent({ event: "failed", ...fields });
        throw new Error("Outbox email unavailable");
      }
      if (outcome === "failed") {
        options.onEvent({ event: "failed", ...fields });
        throw new UnrecoverableError("Outbox email delivery failed");
      }
      options.onEvent({ event: outcome, ...fields });
      return;
    }

    await deliverSealedEmail(job, key, options);
  };
}
