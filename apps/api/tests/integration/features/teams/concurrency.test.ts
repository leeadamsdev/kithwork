import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Team } from "@kithwork/contracts";
import { useTeamFixture } from "./fixtures.js";
const { f, create, mutate, query } = useTeamFixture();

it("rejects stale concurrent edits and duplicate concurrent keys", async () => {
  const org = await f.create();
  const team = await create(org);
  const input = { organisationId: org.id, teamId: team.id, expectedVersion: 1 };
  const edits = await Promise.all(
    ["First", "Second"].map((name) =>
      mutate("update", { ...input, name }, f.alice),
    ),
  );
  expect(edits.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(
    f.data<Team>(
      await query("get", { organisationId: org.id, teamId: team.id }, f.alice),
    ).version,
  ).toBe(2);
  const creations = await Promise.all(
    [0, 1].map(() =>
      mutate(
        "create",
        { organisationId: org.id, key: "RACE", name: "Racing" },
        f.alice,
      ),
    ),
  );
  expect(creations.map((r) => r.statusCode).sort()).toEqual([200, 409]);
});

it("rechecks delegated permissions after waiting and before examining a membership target", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await create(org);
  const input = { organisationId: org.id, teamId: team.id };
  await mutate(
    "members.add",
    { ...input, userId: f.bob.id, role: "maintainer" },
    f.alice,
  );
  const blocker = await f.database.pool.connect();
  let pending: ReturnType<typeof mutate> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM organisation WHERE id=$1 FOR UPDATE", [
      org.id,
    ]);
    pending = mutate(
      "members.changeRole",
      { ...input, userId: randomUUID(), role: "member" },
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
      "UPDATE team_member SET role='member' WHERE organisation_id=$1 AND user_id=$2",
      [org.id, f.bob.id],
    );
    await blocker.query("COMMIT");
    expect((await pending).statusCode).toBe(403);
  } finally {
    await blocker.query("ROLLBACK");
    await pending;
    blocker.release();
  }
});

it("rechecks public self-join eligibility after a concurrent privacy change or archive", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  for (const mode of ["privacy", "archive"]) {
    const team = await create(org, {
      key: mode === "privacy" ? "PRIV" : "ARCH",
    });
    const blocker = await f.database.pool.connect();
    let pending: ReturnType<typeof mutate> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
        [org.id],
      );
      pending = mutate(
        "join",
        { organisationId: org.id, teamId: team.id },
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
        mode === "privacy"
          ? "UPDATE team SET visibility='private' WHERE id=$1"
          : "UPDATE team SET archived_at=now() WHERE id=$1",
        [team.id],
      );
      await blocker.query("COMMIT");
      expect((await pending).statusCode).toBe(mode === "privacy" ? 404 : 409);
      expect(
        (
          await f.database.pool.query(
            "SELECT user_id FROM team_member WHERE team_id=$1 AND user_id=$2",
            [team.id, f.bob.id],
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
