import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { invitationSchema, type InvitationRole } from "@kithwork/contracts";
import { openMessage } from "@kithwork/email/crypto";
import { apiTestEnvironment } from "../../../../fixtures/config.js";
import { useOrganisationFixture, type Actor, type Org } from "../fixtures.js";

export function useInvitationFixture() {
  const fixture = useOrganisationFixture();
  async function invite(
    org: Org,
    {
      actor = fixture.alice,
      email = `${randomUUID()}@example.test`,
      role = "member",
    }: { actor?: Actor; email?: string; role?: InvitationRole } = {},
  ) {
    const response = await fixture.mutate(
      "organisations.invitations.create",
      { organisationId: org.id, email, role },
      actor,
    );
    expect(response.statusCode, response.body).toBe(200);
    return invitationSchema.parse(fixture.data<unknown>(response));
  }
  async function mail(invitationId: string) {
    const result = await fixture.database.pool.query<{
      payload: unknown;
      id: string;
      token_hash: string;
    }>(
      `SELECT o.id,o.payload,i.token_hash FROM email_outbox o JOIN organisation_invitation i
        ON i.id=o.invitation_id AND i.version=o.invitation_version WHERE i.id=$1`,
      [invitationId],
    );
    const row = result.rows[0]!;
    const message = openMessage(
      row.payload,
      Buffer.from(apiTestEnvironment.MAIL_ENCRYPTION_KEY, "base64"),
      row.id,
    );
    const url = new URL(message.url);
    return {
      message,
      url,
      token: new URLSearchParams(url.hash.slice(1)).get("token")!,
      hash: row.token_hash,
      outboxId: row.id,
    };
  }
  return { fixture, invite, mail };
}
