import { randomUUID } from "node:crypto";
import { outboxSchema } from "@kithwork/database";
import { parseEncryptionKey, sealMessage } from "@kithwork/email/crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../../../platform/database/types.js";

const { emailOutbox } = outboxSchema;
export interface InvitationEmailConfig {
  encryptionKey: string;
  webOrigin: string;
}

export async function storeInvitationEmail(
  tx: Transaction,
  config: InvitationEmailConfig,
  input: {
    invitationId: string;
    version: number;
    organisationName: string;
    email: string;
    expiresAt: Date;
    token: string;
    requestId: string;
  },
) {
  const id = randomUUID();
  const url = new URL(`/invitations/${input.invitationId}`, config.webOrigin);
  url.hash = new URLSearchParams({ token: input.token }).toString();
  await tx.insert(emailOutbox).values({
    id,
    invitationId: input.invitationId,
    invitationVersion: input.version,
    requestId: input.requestId,
    expiresAt: input.expiresAt,
    payload: sealMessage(
      {
        kind: "invitation",
        to: input.email,
        organisationName: input.organisationName,
        url: url.toString(),
        expiresAt: input.expiresAt.getTime(),
      },
      parseEncryptionKey(config.encryptionKey),
      id,
    ),
  });
}

export async function cancelInvitationEmails(
  tx: Transaction,
  invitationId: string,
) {
  await tx
    .update(emailOutbox)
    .set({
      payload: null,
      outcome: "skipped",
      lastErrorCode: "obsolete",
      completedAt: sql`clock_timestamp()`,
      publishLeaseId: null,
      publishLeaseUntil: null,
      deliveryLeaseId: null,
      deliveryLeaseUntil: null,
    })
    .where(
      and(
        eq(emailOutbox.invitationId, invitationId),
        isNull(emailOutbox.completedAt),
      ),
    );
}
