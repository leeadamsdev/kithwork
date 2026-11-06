import { expect, it, vi } from "vitest";
import type { Workflow, IssueDetail } from "@kithwork/contracts";
import * as activity from "../../../../src/features/issues/activity.js";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, mutate, get } = useIssueFixture();

async function waitForLock(table: string) {
  await expect
    .poll(
      async () =>
        (
          await f.database.pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
            [`%from "${table}"%`],
          )
        ).rows[0]!.count,
      { timeout: 1500, interval: 10 },
    )
    .toBe(1);
}

it("allocates unique counters for concurrent first creates within and across teams", async () => {
  const org = await f.create();
  const first = await teams.create(org),
    second = await teams.create(org, { key: "WEB" });
  const results = await Promise.all(
    [first, second].flatMap((team) =>
      Array.from({ length: 4 }, () =>
        create({ organisationId: org.id, teamId: team.id }),
      ),
    ),
  );
  for (const team of [first, second])
    expect(
      results
        .filter((row) => row.teamId === team.id)
        .map((row) => row.number)
        .sort(),
    ).toEqual([1, 2, 3, 4]);
});

it("edits unrelated issues while another is locked and re-reads its new status after waiting", async () => {
  const org = await f.create(),
    team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const first = await create(scope),
    second = await create(scope);
  const workflow = f.data<Workflow>(
    await f.query("organisations.teams.workflow.get", scope, f.alice),
  );
  const done = workflow.statuses.find(
    (status) => status.category === "completed",
  )!;
  const release = Promise.withResolvers<void>();
  let waiting = false;
  const original = activity.appendIssueActivity;
  const gate = vi
    .spyOn(activity, "appendIssueActivity")
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      waiting = true;
      await release.promise;
    });
  const pendingFirst = mutate(
    "update",
    {
      organisationId: org.id,
      issueId: first.id,
      expectedVersion: 1,
      statusId: done.id,
    },
    f.alice,
  );
  let pendingSecond: ReturnType<typeof mutate> | undefined;
  try {
    await expect.poll(() => waiting).toBe(true);
    pendingSecond = mutate(
      "update",
      {
        organisationId: org.id,
        issueId: first.id,
        expectedVersion: 2,
        title: "After waiting",
      },
      f.alice,
    );
    await waitForLock("issue");
    const unrelated = await mutate(
      "update",
      {
        organisationId: org.id,
        issueId: second.id,
        expectedVersion: 1,
        title: "Independent",
      },
      f.alice,
    );
    expect(unrelated.statusCode, unrelated.body).toBe(200);
    release.resolve();
    expect((await pendingFirst).statusCode).toBe(200);
    const response = await pendingSecond;
    expect(response.statusCode, response.body).toBe(200);
    expect(f.data<IssueDetail>(response)).toMatchObject({
      version: 3,
      statusId: done.id,
      status: { category: "completed" },
      title: "After waiting",
    });
  } finally {
    release.resolve();
    await pendingFirst;
    await pendingSecond;
    gate.mockRestore();
  }
  const race = await Promise.all(
    ["A", "B"].map((title) =>
      mutate(
        "update",
        {
          organisationId: org.id,
          issueId: first.id,
          expectedVersion: 3,
          title,
        },
        f.alice,
      ),
    ),
  );
  expect(race.map((response) => response.statusCode).sort()).toEqual([
    200, 409,
  ]);
  expect(
    (await get({ organisationId: org.id, issueId: first.id })).version,
  ).toBe(4);
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_activity WHERE issue_id=$1",
        [first.id],
      )
    ).rows,
  ).toEqual([{ count: 4 }]);
});

it("rechecks team privacy after waiting behind administration before mutating an issue", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const value = await create({ organisationId: org.id, teamId: team.id });
  const blocker = await f.database.pool.connect();
  let pending: ReturnType<typeof mutate> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM organisation WHERE id=$1 FOR UPDATE", [
      org.id,
    ]);
    pending = mutate(
      "update",
      {
        organisationId: org.id,
        issueId: value.id,
        expectedVersion: 1,
        title: "Denied",
      },
      f.bob,
    );
    await waitForLock("organisation");
    await blocker.query("UPDATE team SET visibility='private' WHERE id=$1", [
      team.id,
    ]);
    await blocker.query("COMMIT");
    expect((await pending).statusCode).toBe(404);
    expect(
      (await get({ organisationId: org.id, issueId: value.id })).version,
    ).toBe(1);
  } finally {
    await blocker.query("ROLLBACK");
    await pending;
    blocker.release();
  }
});
