import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IssueComment, IssueCommentPage } from "@kithwork/contracts";
import { useCommentFixture } from "./fixtures.js";
const { f, teams, issues, query, mutate, create } = useCommentFixture();

it("preserves Markdown and versions comments independently with body-free correlated events", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    scope = { organisationId: org.id, issueId: issue.id };
  const body = "  Private Markdown\n\n    const value = 1;\n ";
  const comment = await create(scope, body, f.bob);
  expect(comment).toMatchObject({
    body,
    version: 1,
    author: { id: f.bob.id, name: "Bob" },
    capabilities: { canEdit: true, canDelete: true },
    editedAt: null,
    deletedAt: null,
  });
  const input = { ...scope, commentId: comment.id, expectedVersion: 1 };
  const edited = await mutate(
    "update",
    { ...input, body: "Edited Markdown" },
    f.bob,
  );
  expect(edited.statusCode, edited.body).toBe(200);
  expect(f.data<IssueComment>(edited)).toMatchObject({
    version: 2,
    body: "Edited Markdown",
  });
  expect(f.data<IssueComment>(edited).editedAt).toBeTypeOf("string");
  const noop = await mutate(
    "update",
    { ...input, expectedVersion: 2, body: "Edited Markdown" },
    f.bob,
  );
  expect(noop.statusCode, noop.body).toBe(200);
  expect(f.data<IssueComment>(noop).version).toBe(2);
  expect(
    (await mutate("update", { ...input, body: "Stale" }, f.bob)).statusCode,
  ).toBe(409);
  expect((await issues.get({ ...scope })).version).toBe(1);
  const events = await f.database.pool.query<{
    comment_version: number;
    kind: string;
    request_id: string;
    actor_name: string;
  }>(
    "SELECT comment_version,kind,request_id,actor_name FROM issue_comment_event WHERE comment_id=$1 ORDER BY comment_version",
    [comment.id],
  );
  expect(
    events.rows.map((row) => [row.comment_version, row.kind, row.actor_name]),
  ).toEqual([
    [1, "created", "Bob"],
    [2, "edited", "Bob"],
  ]);
  expect(events.rows[1]!.request_id).toBe(edited.headers["x-request-id"]);
  expect(JSON.stringify(events.rows)).not.toContain(body);
  const page = await query("list", scope, f.bob);
  expect(page.statusCode, page.body).toBe(200);
  expect(f.data<IssueCommentPage>(page).items.map((row) => row.id)).toEqual([
    comment.id,
  ]);
  expect(f.logLines.join("")).not.toContain(body);
  expect(f.logLines.join("")).not.toContain("Edited Markdown");
});

it("deduplicates creation retries after edits/deletion without exposing another author's key", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    scope = { organisationId: org.id, issueId: issue.id };
  const key = randomUUID(),
    comment = await create(scope, "Original", f.bob, key);
  const retry = await create(scope, "Original", f.bob, key.toUpperCase());
  expect(retry.id).toBe(comment.id);
  expect(
    (
      await mutate(
        "create",
        { ...scope, creationKey: key, body: "Different" },
        f.bob,
      )
    ).statusCode,
  ).toBe(409);
  const other = await create(scope, "Original", f.alice, key);
  expect(other.id).not.toBe(comment.id);
  const input = { ...scope, commentId: comment.id, expectedVersion: 1 };
  expect(
    (await mutate("update", { ...input, body: "Edited" }, f.bob)).statusCode,
  ).toBe(200);
  expect(await create(scope, "Original", f.bob, key)).toMatchObject({
    id: comment.id,
    version: 2,
    body: "Edited",
  });
  const deleted = await mutate(
    "delete",
    { ...input, expectedVersion: 2 },
    f.alice,
  );
  expect(deleted.statusCode, deleted.body).toBe(200);
  expect(f.data<IssueComment>(deleted)).toMatchObject({
    body: null,
    version: 3,
    capabilities: { canEdit: false, canDelete: false },
  });
  expect(await create(scope, "Original", f.bob, key)).toMatchObject({
    id: comment.id,
    body: null,
    version: 3,
  });
  expect((await mutate("delete", input, f.alice)).statusCode).toBe(200);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 3, body: "Revived" },
        f.bob,
      )
    ).statusCode,
  ).toBe(409);
  const eventCount = await f.database.pool.query(
    "SELECT count(*)::int AS count FROM issue_comment_event WHERE comment_id=$1",
    [comment.id],
  );
  expect(eventCount.rows).toEqual([{ count: 3 }]);
  const response = await query(
    "get",
    { ...scope, commentId: comment.id },
    f.bob,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(response.body).not.toContain("Original");
  expect(response.body).not.toContain("Edited");
  expect(response.body).not.toContain(key);
});
