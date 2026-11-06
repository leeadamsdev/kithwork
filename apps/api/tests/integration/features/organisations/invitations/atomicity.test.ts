import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

describe("invitation transactional rollback", () => {
  const { fixture: f, invite, mail } = useInvitationFixture();
  it("rolls back the invitation when outbox persistence fails and keeps errors private", async () => {
    const org = await f.create();
    const marker = "private-invitation-outbox-failure";
    const email = `${randomUUID()}@example.test`;
    await f.database.pool.query(
      `CREATE FUNCTION fail_invitation_mail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION '${marker}'; END;$$; CREATE TRIGGER fail_invitation_mail BEFORE INSERT ON email_outbox FOR EACH ROW EXECUTE FUNCTION fail_invitation_mail()`,
    );
    try {
      const start = f.logLines.length;
      const response = await f.mutate(
        "organisations.invitations.create",
        { organisationId: org.id, email, role: "member" },
        f.alice,
      );
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(marker);
      expect(
        (
          await f.database.pool.query(
            "SELECT id FROM organisation_invitation WHERE organisation_id=$1",
            [org.id],
          )
        ).rowCount,
      ).toBe(0);
      const logs = f.logLines.slice(start).join("");
      expect(logs).not.toContain(marker);
      expect(logs).not.toContain(email);
      expect(logs).toContain(response.headers["x-request-id"]);
    } finally {
      await f.database.pool.query(
        "DROP TRIGGER fail_invitation_mail ON email_outbox; DROP FUNCTION fail_invitation_mail()",
      );
    }
  });
  it("rolls back acceptance and preserves the token when membership persistence fails", async () => {
    const org = await f.create();
    const invitation = await invite(org, { email: f.bob.email });
    const { token } = await mail(invitation.id);
    await f.database.pool.query(
      "CREATE FUNCTION fail_invitation_membership() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-invitation-membership'; END;$$; CREATE TRIGGER fail_invitation_membership BEFORE INSERT ON organisation_member FOR EACH ROW EXECUTE FUNCTION fail_invitation_membership()",
    );
    try {
      const response = await f.mutate(
        "organisations.invitations.accept",
        { invitationId: invitation.id, token },
        f.bob,
      );
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("private-invitation-membership");
      expect(
        (
          await f.database.pool.query(
            "SELECT status,accepted_by FROM organisation_invitation WHERE id=$1",
            [invitation.id],
          )
        ).rows[0],
      ).toEqual({ status: "pending", accepted_by: null });
      expect(
        (
          await f.database.pool.query(
            "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
            [org.id, f.bob.id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await f.database.pool.query<{ outcome: string | null }>(
            "SELECT outcome FROM email_outbox WHERE invitation_id=$1",
            [invitation.id],
          )
        ).rows[0]?.outcome,
      ).toBeNull();
      expect(f.logLines.join("")).not.toContain(
        "private-invitation-membership",
      );
    } finally {
      await f.database.pool.query(
        "DROP TRIGGER fail_invitation_membership ON organisation_member; DROP FUNCTION fail_invitation_membership()",
      );
    }
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { invitationId: invitation.id, token },
          f.bob,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("rolls back membership changes if dependent invitation cancellation fails", async () => {
    const org = await f.create();
    await f.member(org, f.bob, "admin");
    const invitation = await invite(org, {
      actor: f.bob,
      email: f.carol.email,
    });
    const { token } = await mail(invitation.id);
    await f.database.pool.query(
      "CREATE FUNCTION fail_invitation_cancel() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-cancel-failure'; END;$$; CREATE TRIGGER fail_invitation_cancel BEFORE UPDATE ON email_outbox FOR EACH ROW EXECUTE FUNCTION fail_invitation_cancel()",
    );
    try {
      const response = await f.mutate(
        "organisations.members.changeRole",
        { organisationId: org.id, userId: f.bob.id, role: "member" },
        f.alice,
      );
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain("private-cancel-failure");
      expect(
        (
          await f.database.pool.query<{ role: string }>(
            "SELECT role FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
            [org.id, f.bob.id],
          )
        ).rows[0]?.role,
      ).toBe("admin");
      expect(
        (
          await f.database.pool.query<{ status: string }>(
            "SELECT status FROM organisation_invitation WHERE id=$1",
            [invitation.id],
          )
        ).rows[0]?.status,
      ).toBe("pending");
      expect(f.logLines.join("")).not.toContain("private-cancel-failure");
    } finally {
      await f.database.pool.query(
        "DROP TRIGGER fail_invitation_cancel ON email_outbox; DROP FUNCTION fail_invitation_cancel()",
      );
    }
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { invitationId: invitation.id, token },
          f.carol,
        )
      ).statusCode,
    ).toBe(200);
  });
});
