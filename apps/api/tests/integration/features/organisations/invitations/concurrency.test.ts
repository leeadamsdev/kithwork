import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

describe("invitation concurrent transitions", () => {
  const { fixture: f, invite, mail } = useInvitationFixture();
  it("denies a demoted administrator before revealing whether a target invitation exists", async () => {
    for (const path of ["resend", "revoke"]) {
      const org = await f.create();
      await f.member(org, f.bob, "admin");
      const blocker = await f.database.pool.connect();
      let pending: ReturnType<typeof f.mutate> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
          [org.id],
        );
        pending = f.mutate(
          `organisations.invitations.${path}`,
          { organisationId: org.id, invitationId: randomUUID() },
          f.bob,
        );
        await expect
          .poll(
            async () =>
              (
                await f.database.pool.query<{ count: number }>(
                  "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%from \"organisation\"%'",
                )
              ).rows[0]!.count,
            { timeout: 1500, interval: 10 },
          )
          .toBe(1);
        await blocker.query(
          "UPDATE organisation_member SET role='member' WHERE organisation_id=$1 AND user_id=$2",
          [org.id, f.bob.id],
        );
        await blocker.query("COMMIT");
        expect((await pending).statusCode).toBe(403);
      } finally {
        await blocker.query("ROLLBACK");
        await pending;
        blocker.release();
      }
    }
  });
  it("rechecks an administrator's authority after waiting for the organisation lock", async () => {
    const org = await f.create();
    await f.member(org, f.bob, "admin");
    const blocker = await f.database.pool.connect();
    let pending: ReturnType<typeof f.mutate> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
        [org.id],
      );
      pending = f.mutate(
        "organisations.invitations.create",
        {
          organisationId: org.id,
          email: `${randomUUID()}@example.test`,
          role: "member",
        },
        f.bob,
      );
      await expect
        .poll(
          async () =>
            (
              await f.database.pool.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%from \"organisation\"%'",
              )
            ).rows[0]!.count,
          { timeout: 1500, interval: 10 },
        )
        .toBe(1);
      await blocker.query(
        "UPDATE organisation_member SET role='member' WHERE organisation_id=$1 AND user_id=$2",
        [org.id, f.bob.id],
      );
      await blocker.query("COMMIT");
      expect((await pending).statusCode).toBe(403);
      expect(
        (
          await f.database.pool.query(
            "SELECT id FROM organisation_invitation WHERE organisation_id=$1",
            [org.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      await pending;
      blocker.release();
    }
  });
  it("rechecks expiry and issuer authority for a waiting acceptance", async () => {
    for (const mode of ["expiry", "issuer"]) {
      const org = await f.create();
      await f.member(org, f.bob, "admin");
      const invitation = await invite(org, {
        actor: f.bob,
        email: f.carol.email,
      });
      const { token } = await mail(invitation.id);
      const blocker = await f.database.pool.connect();
      let pending: ReturnType<typeof f.mutate> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
          [org.id],
        );
        pending = f.mutate(
          "organisations.invitations.accept",
          { invitationId: invitation.id, token },
          f.carol,
        );
        await expect
          .poll(
            async () =>
              (
                await f.database.pool.query<{ count: number }>(
                  "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%from \"organisation\"%'",
                )
              ).rows[0]!.count,
            { timeout: 1500, interval: 10 },
          )
          .toBe(1);
        if (mode === "expiry")
          await blocker.query(
            "UPDATE organisation_invitation SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [invitation.id],
          );
        else
          await blocker.query(
            "UPDATE organisation_member SET role='member' WHERE organisation_id=$1 AND user_id=$2",
            [org.id, f.bob.id],
          );
        await blocker.query("COMMIT");
        expect((await pending).statusCode).toBe(404);
        expect(
          (
            await f.database.pool.query(
              "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
              [org.id, f.carol.id],
            )
          ).rowCount,
        ).toBe(0);
      } finally {
        await blocker.query("ROLLBACK");
        await pending;
        blocker.release();
      }
    }
  });
  it("allows only the winning version when acceptance races with a resend", async () => {
    const org = await f.create();
    const invitation = await invite(org, { email: f.bob.email });
    const { token } = await mail(invitation.id);
    await f.database.pool.query(
      "UPDATE organisation_invitation SET last_issued_at=now()-interval '61 seconds' WHERE id=$1",
      [invitation.id],
    );
    const [accepted, resent] = await Promise.all([
      f.mutate(
        "organisations.invitations.accept",
        { invitationId: invitation.id, token },
        f.bob,
      ),
      f.mutate(
        "organisations.invitations.resend",
        { organisationId: org.id, invitationId: invitation.id },
        f.alice,
      ),
    ]);
    if (accepted.statusCode === 200) expect(resent.statusCode).toBe(409);
    else {
      expect(accepted.statusCode).toBe(404);
      expect(resent.statusCode).toBe(200);
      const replacement = await mail(invitation.id);
      expect(
        (
          await f.mutate(
            "organisations.invitations.accept",
            { invitationId: invitation.id, token: replacement.token },
            f.bob,
          )
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await f.database.pool.query(
          "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
          [org.id, f.bob.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("serialises concurrent acceptance and acceptance versus revocation", async () => {
    const org = await f.create();
    const invitation = await invite(org, { email: f.bob.email });
    const { token } = await mail(invitation.id);
    const results = await Promise.all(
      [0, 1].map(() =>
        f.mutate(
          "organisations.invitations.accept",
          { invitationId: invitation.id, token },
          f.bob,
        ),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(
      (
        await f.database.pool.query(
          "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
          [org.id, f.bob.id],
        )
      ).rowCount,
    ).toBe(1);
    const racingOrg = await f.create();
    const racing = await invite(racingOrg, { email: f.carol.email });
    const racingMail = await mail(racing.id);
    const [accept, revoke] = await Promise.all([
      f.mutate(
        "organisations.invitations.accept",
        { invitationId: racing.id, token: racingMail.token },
        f.carol,
      ),
      f.mutate(
        "organisations.invitations.revoke",
        { organisationId: racingOrg.id, invitationId: racing.id },
        f.alice,
      ),
    ]);
    if (accept.statusCode === 200) expect(revoke.statusCode).toBe(409);
    else {
      expect(accept.statusCode).toBe(404);
      expect(revoke.statusCode).toBe(200);
    }
    expect(
      (
        await f.database.pool.query(
          "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
          [racingOrg.id, f.carol.id],
        )
      ).rowCount,
    ).toBe(accept.statusCode === 200 ? 1 : 0);
  });
});
