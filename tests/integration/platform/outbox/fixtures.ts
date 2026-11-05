import { randomBytes, randomUUID, createHash } from "node:crypto";
import { sealMessage } from "@kithwork/email/crypto";
import { createTestDatabase } from "../database/fixtures.js";

export async function outboxDatabase() {
  const database = await createTestDatabase({ migrate: true });
  const key = randomBytes(32);
  const userId = randomUUID(),
    organisationId = randomUUID();
  await database.pool.query(
    "INSERT INTO auth_user(id,name,email) VALUES($1,'Issuer',$2)",
    [userId, `${userId}@example.test`],
  );
  await database.pool.query(
    "INSERT INTO organisation(id,name) VALUES($1,'Team')",
    [organisationId],
  );
  return {
    ...database,
    organisationId,
    userId,
    key,
    async event() {
      const id = randomUUID(),
        invitationId = randomUUID(),
        requestId = randomUUID();
      const token = randomBytes(32).toString("base64url"),
        expiresAt = Date.now() + 86_400_000;
      const to = `${invitationId}@example.test`;
      const message = {
        kind: "invitation" as const,
        to,
        organisationName: "Team",
        url: `https://app.kithwork.test/invitations/${invitationId}#token=${token}`,
        expiresAt,
      };
      await database.pool.query(
        "INSERT INTO organisation_invitation(id,organisation_id,issuer_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,'member',$5,$6)",
        [
          invitationId,
          organisationId,
          userId,
          to,
          createHash("sha256").update(token).digest("hex"),
          new Date(expiresAt),
        ],
      );
      await database.pool.query(
        "INSERT INTO email_outbox(id,invitation_id,invitation_version,payload,expires_at,request_id) VALUES($1,$2,1,$3,$4,$5)",
        [
          id,
          invitationId,
          sealMessage(message, key, id),
          new Date(expiresAt),
          requestId,
        ],
      );
      return { id, invitationId, requestId, expiresAt, message };
    },
  };
}
