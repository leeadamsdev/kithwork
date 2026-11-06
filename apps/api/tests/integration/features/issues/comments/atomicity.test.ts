import { expect, it } from "vitest";
import type { IssueComment } from "@kithwork/contracts";
import { useCommentFixture } from "./fixtures.js";
import { randomUUID } from "node:crypto";
const { f, teams, issues, create, query, mutate } = useCommentFixture();

it("rolls back creation, edits and deletion when correlated event persistence fails", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id },
    comment = await create(scope, "Retain on rollback"),
    input = { ...scope, commentId: comment.id };
  await f.database.pool.query(
    "ALTER TABLE issue_comment_event ADD CONSTRAINT reject_comment_test CHECK (false) NOT VALID",
  );
  try {
    expect(
      (
        await mutate(
          "create",
          { ...scope, body: "Rolled back", creationKey: randomUUID() },
          f.alice,
        )
      ).statusCode,
    ).toBe(500);
    expect(
      (
        await mutate(
          "update",
          { ...input, body: "Rolled back", expectedVersion: 1 },
          f.alice,
        )
      ).statusCode,
    ).toBe(500);
    expect(
      (await mutate("delete", { ...input, expectedVersion: 1 }, f.alice))
        .statusCode,
    ).toBe(500);
    const response = await query("get", input, f.alice);
    expect(response.statusCode, response.body).toBe(200);
    expect(f.data<IssueComment>(response)).toMatchObject({
      body: "Retain on rollback",
      version: 1,
      deletedAt: null,
      editedAt: null,
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
  } finally {
    await f.database.pool.query(
      "ALTER TABLE issue_comment_event DROP CONSTRAINT reject_comment_test",
    );
  }
});

it("rejects exhausted comment versions without overflow or partially removed content", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id },
    comment = await create(scope, "Last version"),
    input = { ...scope, commentId: comment.id, expectedVersion: 2147483647 };
  await f.database.pool.query(
    "UPDATE issue_comment SET version=2147483647 WHERE id=$1",
    [comment.id],
  );
  expect(
    (await mutate("update", { ...input, body: "Overflow" }, f.alice))
      .statusCode,
  ).toBe(409);
  expect((await mutate("delete", input, f.alice)).statusCode).toBe(409);
  const noop = await mutate(
    "update",
    { ...input, body: "Last version" },
    f.alice,
  );
  expect(noop.statusCode, noop.body).toBe(200);
  expect(f.data<IssueComment>(noop).version).toBe(2147483647);
  expect(
    (
      await f.database.pool.query(
        "SELECT body,deleted_at FROM issue_comment WHERE id=$1",
        [comment.id],
      )
    ).rows,
  ).toEqual([{ body: "Last version", deleted_at: null }]);
});
