import { expect, it } from "vitest";
import type { IssueSummary, IssueActivityPage } from "@kithwork/contracts";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, query, mutate } = useIssueFixture();
type Page = { items: IssueSummary[]; nextCursor: string | null };

it("paginates exact millisecond ties after privacy/filter predicates and omits descriptions", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    hidden = await teams.create(org, { key: "SEC", visibility: "private" });
  const scope = { organisationId: org.id, teamId: team.id };
  const issues = await Promise.all(
    [0, 1, 2, 3, 4].map(() =>
      create(scope, { description: "Private full Markdown", priority: "high" }),
    ),
  );
  await create({ organisationId: org.id, teamId: hidden.id });
  await f.database.pool.query(
    "UPDATE issue SET created_at='2026-11-06T12:34:56.123456Z' WHERE organisation_id=$1",
    [org.id],
  );
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await query(
      "list",
      { organisationId: org.id, limit: 2, ...(cursor ? { cursor } : {}) },
      f.bob,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain("description");
    const page = f.data<Page>(response);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toEqual(
    issues
      .map((item) => item.id)
      .sort()
      .reverse(),
  );
  const filtered = await query(
    "list",
    {
      ...scope,
      teamId: team.id.toUpperCase(),
      statusId: issues[0]!.statusId.toUpperCase(),
      category: "backlog",
      priority: "high",
    },
    f.bob,
  );
  expect(f.data<Page>(filtered).items).toHaveLength(5);
  const first = issues[0]!;
  const input = { organisationId: org.id, issueId: first.id };
  await mutate(
    "update",
    { ...input, expectedVersion: 1, title: "Second" },
    f.bob,
  );
  await mutate(
    "update",
    { ...input, expectedVersion: 2, title: "Third" },
    f.bob,
  );
  const history = f.data<IssueActivityPage>(
    await query("activity.list", { ...input, limit: 1 }, f.bob),
  );
  expect(history.items.map((item) => item.issueVersion)).toEqual([1]);
  expect(history.nextCursor).toBe(1);
  const next = f.data<IssueActivityPage>(
    await query("activity.list", { ...input, cursor: 1 }, f.bob),
  );
  expect(next.items.map((item) => item.issueVersion)).toEqual([2, 3]);
  expect(next.nextCursor).toBeNull();
  await mutate("archive", { ...input, expectedVersion: 3 }, f.alice);
  expect(f.data<Page>(await query("list", scope, f.bob)).items).toHaveLength(4);
  expect(
    f
      .data<Page>(await query("list", { ...scope, archived: "only" }, f.bob))
      .items.map((item) => item.id),
  ).toEqual([first.id]);
  await teams.mutate("archive", { ...scope, expectedVersion: 1 }, f.alice);
  expect(
    f.data<Page>(await query("list", { organisationId: org.id }, f.bob)).items,
  ).toEqual([]);
  expect(
    f.data<Page>(
      await query(
        "list",
        {
          organisationId: org.id,
          includeArchivedTeams: true,
          archived: "include",
        },
        f.bob,
      ),
    ).items,
  ).toHaveLength(5);
});
