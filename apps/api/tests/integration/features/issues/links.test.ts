import { expect, it } from "vitest";
import type {
  IssueDetail,
  IssueActivityPage,
  Project,
} from "@kithwork/contracts";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, get, query, mutate } = useIssueFixture();

it("assigns eligible organisation members, links participating projects and versions typed link history", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol, "admin");
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const project = f.data<Project>(
    await f.mutate(
      "organisations.projects.create",
      { organisationId: org.id, name: "Launch", teamIds: [team.id] },
      f.alice,
    ),
  );
  const issue = await create(
    scope,
    { assigneeId: f.bob.id, projectId: project.id },
    f.bob,
  );
  expect(issue).toMatchObject({
    assigneeId: f.bob.id,
    assignee: { id: f.bob.id, name: "Bob" },
    projectId: project.id,
    project: { id: project.id, name: "Launch", archivedAt: null },
  });
  const input = {
    organisationId: org.id,
    issueId: issue.id,
    expectedVersion: 1,
  };
  const edited = await mutate(
    "update",
    { ...input, assigneeId: f.carol.id, projectId: null },
    f.bob,
  );
  expect(edited.statusCode, edited.body).toBe(200);
  expect(f.data<IssueDetail>(edited)).toMatchObject({
    version: 2,
    assignee: { id: f.carol.id, name: "Carol" },
    projectId: null,
    project: null,
  });
  const noop = await mutate(
    "update",
    {
      ...input,
      expectedVersion: 2,
      assigneeId: f.carol.id.toUpperCase(),
      projectId: null,
    },
    f.bob,
  );
  expect(noop.statusCode, noop.body).toBe(200);
  expect(f.data<IssueDetail>(noop).version).toBe(2);
  const history = f.data<IssueActivityPage>(
    await query(
      "activity.list",
      { organisationId: org.id, issueId: issue.id },
      f.bob,
    ),
  );
  expect(history.items).toHaveLength(2);
  expect(history.items[0]!.changes).toMatchObject({
    assignee: { from: null, to: { id: f.bob.id, name: "Bob" } },
    project: {
      from: null,
      to: { available: true, id: project.id, name: "Launch" },
    },
  });
  expect(history.items[1]!.changes).toMatchObject({
    assignee: {
      from: { id: f.bob.id, name: "Bob" },
      to: { id: f.carol.id, name: "Carol" },
    },
    project: {
      from: { available: true, id: project.id, name: "Launch" },
      to: null,
    },
  });
  expect(JSON.stringify(history)).not.toContain(f.bob.email);
  const linked = await create(scope, {
    assigneeId: f.carol.id,
    projectId: project.id,
  });
  const filtered = await query(
    "list",
    {
      organisationId: org.id,
      assigneeId: f.carol.id.toUpperCase(),
      projectId: project.id.toUpperCase(),
    },
    f.bob,
  );
  expect(filtered.statusCode, filtered.body).toBe(200);
  expect(
    f.data<{ items: { id: string }[] }>(filtered).items.map((row) => row.id),
  ).toEqual([linked.id]);
  const clear = await mutate(
    "update",
    {
      organisationId: org.id,
      issueId: linked.id,
      expectedVersion: 1,
      assigneeId: null,
      projectId: null,
    },
    f.bob,
  );
  expect(clear.statusCode, clear.body).toBe(200);
  expect(
    (await get({ organisationId: org.id, issueId: linked.id })).assignee,
  ).toBeNull();
});

it("restricts private-team assignments and paginates only eligible IDs/names", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol, "admin");
  const team = await teams.create(org, { visibility: "private" });
  const scope = { organisationId: org.id, teamId: team.id };
  expect(
    (
      await mutate(
        "create",
        { ...scope, title: "Denied", assigneeId: f.bob.id },
        f.alice,
      )
    ).statusCode,
  ).toBe(404);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await query(
      "assignees.list",
      { ...scope, limit: 1, ...(cursor ? { cursor } : {}) },
      f.alice,
    );
    expect(response.statusCode, response.body).toBe(200);
    const page = f.data<{
      items: { id: string; name: string }[];
      nextCursor: string | null;
    }>(response);
    for (const item of page.items)
      expect(Object.keys(item).sort()).toEqual(["id", "name"]);
    ids.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids.sort()).toEqual([f.alice.id, f.carol.id].sort());
  expect((await query("assignees.list", scope, f.bob)).statusCode).toBe(404);
  await teams.mutate("members.add", { ...scope, userId: f.bob.id }, f.alice);
  const issue = await create(scope, { assigneeId: f.bob.id });
  expect(issue.assigneeId).toBe(f.bob.id);
  const adminIssue = await create(scope, { assigneeId: f.carol.id });
  expect(adminIssue.assigneeId).toBe(f.carol.id);
});
