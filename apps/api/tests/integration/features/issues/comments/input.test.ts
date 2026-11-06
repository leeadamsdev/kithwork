import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IssueComment } from "@kithwork/contracts";
import { useCommentFixture } from "./fixtures.js";

const { f, teams, issues, create, query, mutate } = useCommentFixture();

it("rejects NUL-containing creates and edits without changing comments or audit events", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const issue = await issues.create({
    organisationId: org.id,
    teamId: team.id,
  });
  const scope = { organisationId: org.id, issueId: issue.id };
  const comment = await create(scope, "Original");
  const input = { ...scope, commentId: comment.id, expectedVersion: 1 };
  for (const body of ["\u0000", "example\u0000text"]) {
    const post = await mutate(
      "create",
      { ...scope, creationKey: randomUUID(), body },
      f.alice,
    );
    expect(post.statusCode, post.body).toBe(400);
    const edit = await mutate("update", { ...input, body }, f.alice);
    expect(edit.statusCode, edit.body).toBe(400);
  }
  const response = await query(
    "get",
    { ...scope, commentId: comment.id },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(f.data<IssueComment>(response)).toMatchObject({
    body: "Original",
    version: 1,
  });
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment WHERE issue_id=$1",
        [issue.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment_event WHERE issue_id=$1",
        [issue.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
