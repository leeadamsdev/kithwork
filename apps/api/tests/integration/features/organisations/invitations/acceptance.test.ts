import { randomUUID } from "node:crypto";
import {
  organisationSchema,
  invitationPreviewSchema,
} from "@kithwork/contracts";
import { describe, expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

describe("invitation recipient access", () => {
  const { fixture: f, invite, mail } = useInvitationFixture();
  it("previews only for the matching verified account and atomically accepts once", async () => {
    const org = await f.create();
    const invitation = await invite(org, { email: f.bob.email });
    const { token } = await mail(invitation.id);
    const input = { invitationId: invitation.id };
    for (const [actor, status] of [
      [undefined, 401],
      [f.carol, 404],
      [f.alice, 404],
    ] as const)
      expect(
        (await f.query("organisations.invitations.preview", input, actor))
          .statusCode,
      ).toBe(status);
    const preview = await f.query(
      "organisations.invitations.preview",
      input,
      f.bob,
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(
      invitationPreviewSchema.parse(f.data<unknown>(preview)),
    ).toMatchObject({
      organisationId: org.id,
      organisationName: org.name,
      role: "member",
    });
    expect(preview.body).not.toMatch(/email|token|issuer|hash/i);
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { ...input, token: "a".repeat(43) },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { ...input, token },
          f.carol,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { ...input, token, role: "owner" },
          f.bob,
        )
      ).statusCode,
    ).toBe(400);
    const accepted = await f.mutate(
      "organisations.invitations.accept",
      { ...input, token },
      f.bob,
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(organisationSchema.parse(f.data<unknown>(accepted))).toMatchObject({
      id: org.id,
      role: "member",
    });
    const recorded = await f.database.pool.query<{
      status: string;
      accepted_by: string;
      accepted_at: Date;
    }>(
      "SELECT status,accepted_by,accepted_at FROM organisation_invitation WHERE id=$1",
      [invitation.id],
    );
    expect(recorded.rows[0]).toMatchObject({
      status: "accepted",
      accepted_by: f.bob.id,
    });
    expect(recorded.rows[0]!.accepted_at).toBeInstanceOf(Date);
    expect(
      (
        await f.database.pool.query(
          "SELECT payload,outcome FROM email_outbox WHERE invitation_id=$1",
          [invitation.id],
        )
      ).rows[0],
    ).toEqual({ payload: null, outcome: "skipped" });
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { ...input, token },
          f.bob,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.database.pool.query(
          "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
          [org.id, f.bob.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(f.logLines.join("")).not.toContain(token);
    expect(
      (
        await f.mutate(
          "organisations.invitations.resend",
          { organisationId: org.id, ...input },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await f.mutate(
          "organisations.invitations.revoke",
          { organisationId: org.id, ...input },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
    await f.mutate(
      "organisations.members.remove",
      { organisationId: org.id, userId: f.bob.id },
      f.alice,
    );
    expect(
      (
        await f.mutate(
          "organisations.invitations.accept",
          { ...input, token },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.database.pool.query(
          "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
          [org.id, f.bob.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("preserves an existing membership and returns its current role on a safe retry", async () => {
    const org = await f.create();
    const invitation = await invite(org, { email: f.bob.email });
    const { token } = await mail(invitation.id);
    await f.member(org, f.bob, "admin");
    const input = { invitationId: invitation.id, token };
    const accepted = await f.mutate(
      "organisations.invitations.accept",
      input,
      f.bob,
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(f.data<{ role: string }>(accepted).role).toBe("admin");
    await f.mutate(
      "organisations.members.changeRole",
      { organisationId: org.id, userId: f.bob.id, role: "owner" },
      f.alice,
    );
    const retry = await f.mutate(
      "organisations.invitations.accept",
      input,
      f.bob,
    );
    expect(retry.statusCode, retry.body).toBe(200);
    expect(f.data<{ role: string }>(retry).role).toBe("owner");
  });
  it("rejects expired, revoked and superseded tokens without adding membership", async () => {
    for (const mode of ["expired", "revoked", "superseded"] as const) {
      const org = await f.create();
      const invitation = await invite(org, { email: f.bob.email });
      const { token } = await mail(invitation.id);
      if (mode === "expired")
        await f.database.pool.query(
          "UPDATE organisation_invitation SET expires_at=now()-interval '1 second' WHERE id=$1",
          [invitation.id],
        );
      else if (mode === "revoked")
        await f.mutate(
          "organisations.invitations.revoke",
          { organisationId: org.id, invitationId: invitation.id },
          f.alice,
        );
      else {
        await f.database.pool.query(
          "UPDATE organisation_invitation SET last_issued_at=now()-interval '61 seconds' WHERE id=$1",
          [invitation.id],
        );
        expect(
          (
            await f.mutate(
              "organisations.invitations.resend",
              { organisationId: org.id, invitationId: invitation.id },
              f.alice,
            )
          ).statusCode,
        ).toBe(200);
      }
      expect(
        (
          await f.mutate(
            "organisations.invitations.accept",
            { invitationId: invitation.id, token },
            f.bob,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await f.database.pool.query(
            "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
            [org.id, f.bob.id],
          )
        ).rowCount,
      ).toBe(0);
      if (mode !== "superseded")
        expect(
          (
            await f.query(
              "organisations.invitations.preview",
              { invitationId: invitation.id },
              f.bob,
            )
          ).statusCode,
        ).toBe(404);
    }
    expect(
      (
        await f.query(
          "organisations.invitations.preview",
          { invitationId: randomUUID() },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
  });
});
