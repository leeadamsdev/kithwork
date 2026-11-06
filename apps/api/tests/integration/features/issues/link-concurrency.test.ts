import { expect, it, vi } from "vitest";
import type { Project } from "@kithwork/contracts";
import * as activity from "../../../../src/features/issues/activity.js";
import * as cleanup from "../../../../src/features/issues/assignment-cleanup.js";
import * as projectTransactions from "../../../../src/features/projects/transaction.js";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, get, mutate } = useIssueFixture();

async function waitForAdministrationBarrier() {
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
}

it("finishes assignment before waiting membership removal clears it, without deadlocks or lost history", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const release = Promise.withResolvers<void>();
  let entered = false;
  const original = activity.appendIssueActivity;
  const gate = vi
    .spyOn(activity, "appendIssueActivity")
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      entered = true;
      await release.promise;
    });
  const creation = create(
    { organisationId: org.id, teamId: team.id },
    { assigneeId: f.bob.id },
  );
  let removal: ReturnType<typeof f.mutate> | undefined;
  try {
    await expect.poll(() => entered).toBe(true);
    removal = f.mutate(
      "organisations.members.remove",
      { organisationId: org.id, userId: f.bob.id },
      f.alice,
    );
    await waitForAdministrationBarrier();
    release.resolve();
    const issue = await creation;
    const response = await removal;
    expect(response.statusCode, response.body).toBe(200);
    expect(
      await get({ organisationId: org.id, issueId: issue.id }),
    ).toMatchObject({ version: 2, assigneeId: null });
    expect(
      (
        await f.database.pool.query(
          "SELECT issue_version,kind FROM issue_activity WHERE issue_id=$1 ORDER BY issue_version",
          [issue.id],
        )
      ).rows,
    ).toEqual([
      { issue_version: 1, kind: "created" },
      { issue_version: 2, kind: "assignment_cleared" },
    ]);
  } finally {
    release.resolve();
    await creation;
    await removal;
    gate.mockRestore();
  }
});

it("rechecks assignment eligibility after waiting behind organisation removal", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const release = Promise.withResolvers<void>();
  let entered = false;
  const original = cleanup.clearIssueAssignments;
  const gate = vi
    .spyOn(cleanup, "clearIssueAssignments")
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      entered = true;
      await release.promise;
    });
  const removal = f.mutate(
    "organisations.members.remove",
    { organisationId: org.id, userId: f.bob.id },
    f.alice,
  );
  let creation: ReturnType<typeof mutate> | undefined;
  try {
    await expect.poll(() => entered).toBe(true);
    creation = mutate(
      "create",
      {
        organisationId: org.id,
        teamId: team.id,
        title: "Revoked",
        assigneeId: f.bob.id,
      },
      f.alice,
    );
    await waitForAdministrationBarrier();
    release.resolve();
    expect((await removal).statusCode).toBe(200);
    const response = await creation;
    expect(response.statusCode, response.body).toBe(404);
    expect(
      (
        await f.database.pool.query(
          "SELECT count(*)::int AS count FROM issue WHERE organisation_id=$1",
          [org.id],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    release.resolve();
    await removal;
    await creation;
    gate.mockRestore();
  }
});

it.each([false, true])(
  "serializes project detachment against issue linking in both orders (detach first=%s)",
  async (detachFirst) => {
    const org = await f.create(),
      team = await teams.create(org),
      other = await teams.create(org, { key: "WEB" });
    const project = f.data<Project>(
      await f.mutate(
        "organisations.projects.create",
        { organisationId: org.id, name: "Race", teamIds: [team.id, other.id] },
        f.alice,
      ),
    );
    const release = Promise.withResolvers<void>();
    let entered = false;
    const hold = async () => {
      entered = true;
      await release.promise;
    };
    const originalSave = projectTransactions.saveProject,
      originalAppend = activity.appendIssueActivity;
    const gate = detachFirst
      ? vi
          .spyOn(projectTransactions, "saveProject")
          .mockImplementationOnce(async (...args) => {
            const result = await originalSave(...args);
            await hold();
            return result;
          })
      : vi
          .spyOn(activity, "appendIssueActivity")
          .mockImplementationOnce(async (...args) => {
            await originalAppend(...args);
            await hold();
          });
    const detach = () =>
      f.mutate(
        "organisations.projects.setTeams",
        {
          organisationId: org.id,
          projectId: project.id,
          expectedVersion: 1,
          teamIds: [other.id],
        },
        f.alice,
      );
    const link = () =>
      mutate(
        "create",
        {
          organisationId: org.id,
          teamId: team.id,
          title: "Concurrent",
          projectId: project.id,
        },
        f.alice,
      );
    const first = detachFirst ? detach() : link();
    let second: ReturnType<typeof link> | undefined;
    try {
      await expect.poll(() => entered).toBe(true);
      second = detachFirst ? link() : detach();
      await waitForAdministrationBarrier();
      release.resolve();
      expect((await first).statusCode).toBe(200);
      const response = await second;
      expect(response.statusCode, response.body).toBe(409);
      const rows = await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue i LEFT JOIN project_team pt ON pt.organisation_id=i.organisation_id AND pt.project_id=i.project_id AND pt.team_id=i.team_id WHERE i.organisation_id=$1 AND i.project_id IS NOT NULL AND pt.project_id IS NULL",
        [org.id],
      );
      expect(rows.rows).toEqual([{ count: 0 }]);
    } finally {
      release.resolve();
      await first;
      await second;
      gate.mockRestore();
    }
  },
);
