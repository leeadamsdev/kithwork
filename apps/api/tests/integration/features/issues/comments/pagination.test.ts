import { expect, it, vi } from "vitest";
import type { IssueComment, IssueCommentPage } from "@kithwork/contracts";
import * as issueAccess from "../../../../../src/features/issues/access.js";
import { useCommentFixture } from "./fixtures.js";
const { f, teams, issues, create, query, mutate } = useCommentFixture();

it("paginates exact timestamp ties with tombstones and exposes only safe comment fields", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    scope = { organisationId: org.id, issueId: issue.id };
  const comments = await Promise.all(
    Array.from({ length: 5 }, () => create(scope, "Markdown", f.bob)),
  );
  await mutate(
    "delete",
    { ...scope, commentId: comments[2]!.id, expectedVersion: 1 },
    f.bob,
  );
  await f.database.pool.query(
    "UPDATE issue_comment SET created_at='2026-11-06T12:34:56.123456Z' WHERE issue_id=$1",
    [issue.id],
  );
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await query(
      "list",
      { ...scope, limit: 2, ...(cursor ? { cursor } : {}) },
      f.bob,
    );
    expect(response.statusCode, response.body).toBe(200);
    const page = f.data<IssueCommentPage>(response);
    ids.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor ?? undefined;
    expect(
      page.items.every((row) => row.createdAt === "2026-11-06T12:34:56.123Z"),
    ).toBe(true);
    expect(response.body).not.toContain("creationHash");
    expect(response.body).not.toContain("creationKey");
    expect(response.body).not.toContain(f.bob.email);
  } while (cursor);
  expect(ids).toEqual(comments.map((row) => row.id).sort());
  const tombstone = await query(
    "get",
    { ...scope, commentId: comments[2]!.id },
    f.alice,
  );
  expect(f.data<IssueComment>(tombstone).body).toBeNull();
});

it("rechecks data-query visibility after an issue precheck and retains a departed author's attribution", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    scope = { organisationId: org.id, issueId: issue.id };
  const comment = await create(scope, "Retained attribution", f.bob);
  const original = issueAccess.readIssueAccess;
  const gate = vi
    .spyOn(issueAccess, "readIssueAccess")
    .mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await f.database.pool.query(
        "UPDATE team SET visibility='private' WHERE id=$1",
        [team.id],
      );
      return result;
    });
  try {
    const response = await query("list", scope, f.bob);
    expect(response.statusCode, response.body).toBe(200);
    expect(f.data<IssueCommentPage>(response).items).toEqual([]);
    expect(response.body).not.toContain("Retained attribution");
  } finally {
    gate.mockRestore();
  }
  await f.mutate(
    "organisations.members.remove",
    { organisationId: org.id, userId: f.bob.id },
    f.alice,
  );
  const response = await query(
    "get",
    { ...scope, commentId: comment.id },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(f.data<IssueComment>(response)).toMatchObject({
    author: { id: f.bob.id, name: "Bob" },
    body: "Retained attribution",
  });
});
