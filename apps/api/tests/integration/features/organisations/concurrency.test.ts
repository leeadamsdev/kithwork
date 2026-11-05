import { describe, expect, it } from "vitest";
import { useOrganisationFixture, type Org } from "./fixtures.js";
describe("concurrency", () => {
  const fixture = useOrganisationFixture();
  it("retains an owner when owners concurrently leave or demote themselves", async () => {
    for (const mode of ["leave", "demote"]) {
      const org = await fixture.create();
      await fixture.member(org, fixture.bob, "owner");
      const results = await Promise.all(
        [fixture.alice, fixture.bob].map((actor) =>
          mode === "leave"
            ? fixture.mutate(
                "organisations.leave",
                { organisationId: org.id },
                actor,
              )
            : fixture.mutate(
                "organisations.members.changeRole",
                { organisationId: org.id, userId: actor.id, role: "admin" },
                actor,
              ),
        ),
      );
      expect(results.map((result) => result.statusCode).sort()).toEqual([
        200, 409,
      ]);
      expect(
        (
          await fixture.database.pool.query(
            "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND role='owner'",
            [org.id],
          )
        ).rows,
      ).toHaveLength(1);
    }
  });
  it("rechecks a waiting administrator's permissions after acquiring the organisation lock", async () => {
    const org = await fixture.create();
    await fixture.member(org, fixture.bob, "admin");
    const blocker = await fixture.database.pool.connect();
    let committed = false;
    let pending: ReturnType<typeof fixture.mutate> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
        [org.id],
      );
      pending = fixture.mutate(
        "organisations.update",
        { organisationId: org.id, name: "Stale admin write" },
        fixture.bob,
      );
      await expect
        .poll(
          async () =>
            (
              await fixture.database.pool.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%from \"organisation\"%'",
              )
            ).rows[0]!.count,
          { timeout: 1500, interval: 10 },
        )
        .toBe(1);
      await blocker.query(
        "UPDATE organisation_member SET role='member' WHERE organisation_id=$1 AND user_id=$2",
        [org.id, fixture.bob.id],
      );
      await blocker.query("COMMIT");
      committed = true;
      expect((await pending).statusCode).toBe(403);
      expect(
        fixture.data<Org>(
          await fixture.query(
            "organisations.get",
            { organisationId: org.id },
            fixture.alice,
          ),
        ).name,
      ).toBe("Engineering");
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });
  it("bounds lock waits and reports a safe retryable conflict", async () => {
    const org = await fixture.create();
    const blocker = await fixture.database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
        [org.id],
      );
      const response = await fixture.mutate(
        "organisations.update",
        { organisationId: org.id, name: "Blocked" },
        fixture.alice,
      );
      expect(response.statusCode).toBe(409);
      expect(response.body).not.toMatch(/select|parameters|lock_timeout/);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
});
