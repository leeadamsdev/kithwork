import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

describe("invitation issuer permission changes", () => {
  const { fixture: f, invite, mail } = useInvitationFixture();
  it("cancels only grants an owner can no longer make after demotion to admin", async () => {
    const org = await f.create();
    await f.member(org, f.bob, "owner");
    const member = await invite(org, { email: f.carol.email });
    const admin = await invite(org, { role: "admin" });
    const token = (await mail(member.id)).token;
    expect(
      (
        await f.mutate(
          "organisations.members.changeRole",
          { organisationId: org.id, userId: f.alice.id, role: "admin" },
          f.bob,
        )
      ).statusCode,
    ).toBe(200);
    const rows = (
      await f.database.pool.query<{ id: string; status: string }>(
        "SELECT id,status FROM organisation_invitation WHERE organisation_id=$1",
        [org.id],
      )
    ).rows;
    expect(rows.find((row) => row.id === member.id)?.status).toBe("pending");
    expect(rows.find((row) => row.id === admin.id)?.status).toBe("revoked");
    expect(
      (
        await f.database.pool.query(
          "SELECT payload,outcome FROM email_outbox WHERE invitation_id=$1",
          [admin.id],
        )
      ).rows[0],
    ).toEqual({ payload: null, outcome: "skipped" });
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { invitationId: member.id, token },
          f.carol,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("cancels pending invitations and email leases when an issuer is demoted, removed or leaves", async () => {
    for (const mode of ["demote", "remove", "leave"]) {
      const org = await f.create();
      await f.member(org, f.bob, "admin");
      const invitation = await invite(org, {
        actor: f.bob,
        email: f.carol.email,
      });
      const { token } = await mail(invitation.id);
      await f.database.pool.query(
        "UPDATE email_outbox SET delivery_lease_id=$2,delivery_lease_until=now()+interval '30 seconds' WHERE invitation_id=$1",
        [invitation.id, randomUUID()],
      );
      const response =
        mode === "leave"
          ? await f.mutate(
              "organisations.leave",
              { organisationId: org.id },
              f.bob,
            )
          : await f.mutate(
              `organisations.members.${mode === "demote" ? "changeRole" : "remove"}`,
              {
                organisationId: org.id,
                userId: f.bob.id,
                ...(mode === "demote" ? { role: "member" } : {}),
              },
              f.alice,
            );
      expect(response.statusCode, response.body).toBe(200);
      expect(
        (
          await f.database.pool.query<{ status: string }>(
            "SELECT status FROM organisation_invitation WHERE id=$1",
            [invitation.id],
          )
        ).rows[0]?.status,
      ).toBe("revoked");
      expect(
        (
          await f.database.pool.query(
            "SELECT payload,outcome,delivery_lease_id,publish_lease_id FROM email_outbox WHERE invitation_id=$1",
            [invitation.id],
          )
        ).rows[0],
      ).toEqual({
        payload: null,
        outcome: "skipped",
        delivery_lease_id: null,
        publish_lease_id: null,
      });
      expect(
        (
          await f.mutate(
            "organisations.invitations.accept",
            { invitationId: invitation.id, token },
            f.carol,
          )
        ).statusCode,
      ).toBe(404);
    }
  });
});
