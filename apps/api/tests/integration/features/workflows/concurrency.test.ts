import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useWorkflowFixture } from "./fixtures.js";

const { f, teams, get, change, mutate } = useWorkflowFixture();

it("serialises concurrent workflow edits, default changes and retirements", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  let workflow = await change("create", {
    ...scope,
    expectedWorkflowVersion: 1,
    name: "Review",
    category: "started",
  });
  const started = workflow.statuses.filter((s) => s.category === "started");
  const edits = await Promise.all(
    started.map((s) =>
      mutate(
        "retire",
        {
          ...scope,
          expectedWorkflowVersion: 2,
          statusId: s.id,
        },
        f.alice,
      ),
    ),
  );
  expect(edits.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  workflow = await get(scope);
  expect(workflow.version).toBe(3);
  expect(
    workflow.statuses.filter((s) => s.category === "started"),
  ).toHaveLength(1);
  const todo = workflow.statuses.find((s) => s.category === "unstarted")!;
  const defaults = await Promise.all([
    mutate(
      "setDefault",
      { ...scope, expectedWorkflowVersion: 3, statusId: todo.id },
      f.alice,
    ),
    mutate(
      "update",
      {
        ...scope,
        expectedWorkflowVersion: 3,
        statusId: todo.id,
        name: "Ready",
      },
      f.alice,
    ),
  ]);
  expect(defaults.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  workflow = await get(scope);
  expect(workflow.version).toBe(4);
  expect(workflow.statuses.filter((s) => s.isDefault)).toHaveLength(1);
});

it("rechecks maintainer permissions after waiting before examining the status", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  await teams.mutate(
    "members.add",
    { ...scope, userId: f.bob.id, role: "maintainer" },
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
      "retire",
      { ...scope, statusId: randomUUID(), expectedWorkflowVersion: 1 },
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
      "UPDATE team_member SET role='member' WHERE team_id=$1 AND user_id=$2",
      [team.id, f.bob.id],
    );
    await blocker.query("COMMIT");
    expect((await pending).statusCode).toBe(403);
    expect((await get(scope)).version).toBe(1);
  } finally {
    await blocker.query("ROLLBACK");
    await pending;
    blocker.release();
  }
});
