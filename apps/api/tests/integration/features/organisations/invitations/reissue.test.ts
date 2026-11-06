import { describe, expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

describe("expired invitation reissue", () => {
  const { fixture: f, invite, mail } = useInvitationFixture();

  it("refreshes an expired invitation without accepting its previous token", async () => {
    const org = await f.create();
    const invitation = await invite(org, { email: f.bob.email });
    const first = await mail(invitation.id);
    await f.database.pool.query(
      "UPDATE organisation_invitation SET status='expired',expires_at=now()-interval '1 day',last_issued_at=now()-interval '2 days' WHERE id=$1",
      [invitation.id],
    );
    const response = await f.mutate(
      "organisations.invitations.resend",
      { organisationId: org.id, invitationId: invitation.id },
      f.alice,
    );
    expect(response.statusCode, response.body).toBe(200);
    const second = await mail(invitation.id);
    expect(second.token).not.toBe(first.token);
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { invitationId: invitation.id, token: first.token },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { invitationId: invitation.id, token: second.token },
          f.bob,
        )
      ).statusCode,
    ).toBe(200);
  });

  it("expires a stale pending record before creating a fresh invitation and keeps its tenant scope", async () => {
    const org = await f.create();
    const previous = await invite(org, { email: f.bob.email });
    await f.database.pool.query(
      "UPDATE organisation_invitation SET expires_at=now()-interval '1 day' WHERE id=$1",
      [previous.id],
    );
    const fresh = await invite(org, { email: f.bob.email, role: "admin" });
    expect(fresh.id).not.toBe(previous.id);
    expect(
      (
        await f.database.pool.query<{ status: string }>(
          "SELECT status FROM organisation_invitation WHERE id=$1",
          [previous.id],
        )
      ).rows[0]?.status,
    ).toBe("expired");
    expect(
      (
        await f.database.pool.query(
          "SELECT payload,outcome FROM email_outbox WHERE invitation_id=$1",
          [previous.id],
        )
      ).rows[0],
    ).toEqual({ payload: null, outcome: "skipped" });
    await f.database.pool.query(
      "UPDATE organisation_invitation SET last_issued_at=now()-interval '61 seconds' WHERE id=$1",
      [previous.id],
    );
    expect(
      (
        await f.mutate(
          "organisations.invitations.resend",
          { organisationId: org.id, invitationId: previous.id },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
    const other = await f.create(f.bob);
    expect(
      (
        await f.mutate(
          "organisations.invitations.revoke",
          { organisationId: other.id, invitationId: fresh.id },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.database.pool.query<{ status: string }>(
          "SELECT status FROM organisation_invitation WHERE id=$1",
          [fresh.id],
        )
      ).rows[0]?.status,
    ).toBe("pending");
  });
});
