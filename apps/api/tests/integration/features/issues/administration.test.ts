import { expect, it } from "vitest";
import type { IssueDetail, IssueActivityPage } from "@kithwork/contracts";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, query, mutate, get } = useIssueFixture();

it("creates numbered issues with current defaults and atomic, privacy-safe versioned activity", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const issue = await create(
    scope,
    {
      title: "  Fix race  ",
      description: "  code\n\n    exact  ",
      dueDate: "2028-02-29",
    },
    f.bob,
  );
  expect(issue).toMatchObject({
    identifier: "ENG-1",
    number: 1,
    title: "Fix race",
    description: "  code\n\n    exact  ",
    priority: "none",
    version: 1,
    dueDate: "2028-02-29",
    creatorId: f.bob.id,
    status: { name: "Backlog", category: "backlog" },
    capabilities: { canEdit: true, canArchive: false, canRestore: false },
  });
  const input = {
    organisationId: org.id,
    issueId: issue.id,
    expectedVersion: 1,
  };
  const response = await mutate(
    "update",
    {
      ...input,
      title: "Fixed",
      description: null,
      priority: "high",
      dueDate: null,
    },
    f.bob,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(f.data<IssueDetail>(response)).toMatchObject({
    version: 2,
    title: "Fixed",
    description: null,
    priority: "high",
    dueDate: null,
  });
  expect(
    (await mutate("update", { ...input, title: "Stale" }, f.bob)).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 2, title: " Fixed " },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
  expect((await get(input)).version).toBe(2);
  const history = await query(
    "activity.list",
    { organisationId: org.id, issueId: issue.id },
    f.bob,
  );
  expect(history.statusCode, history.body).toBe(200);
  const entries = f.data<IssueActivityPage>(history).items;
  expect(entries.map((e) => [e.issueVersion, e.kind, e.actor.name])).toEqual([
    [1, "created", "Bob"],
    [2, "updated", "Bob"],
  ]);
  expect(entries[1]!.changes).toMatchObject({
    title: { from: "Fix race", to: "Fixed" },
    description: { changed: true },
    priority: { from: "none", to: "high" },
    dueDate: { from: "2028-02-29", to: null },
  });
  expect(history.body).not.toContain("code");
  expect(history.body).not.toContain(f.bob.email);
  const byIdentifier = await query(
    "getByIdentifier",
    { organisationId: org.id, identifier: " eng-1 " },
    f.bob,
  );
  expect(byIdentifier.statusCode).toBe(200);
  expect(f.data<IssueDetail>(byIdentifier).id).toBe(issue.id);
  const second = await create(scope);
  expect(second.identifier).toBe("ENG-2");
  await f.mutate(
    "organisations.members.remove",
    { organisationId: org.id, userId: f.bob.id },
    f.alice,
  );
  expect((await get(input)).creatorId).toBe(f.bob.id);
  expect(
    (
      await query(
        "activity.list",
        { organisationId: org.id, issueId: issue.id },
        f.bob,
      )
    ).statusCode,
  ).toBe(404);
});
