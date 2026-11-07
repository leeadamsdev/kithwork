import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { formatUserMention, type IssueComment } from "@kithwork/contracts";
import { useCommentFixture } from "./fixtures.js";
const { f, teams, issues, create, query, mutate } = useCommentFixture();

it("rolls back a comment, its mentions and metadata when automatic following fails", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  await f.database.pool.query(
    "ALTER TABLE issue_subscription ADD CONSTRAINT reject_subscription_test CHECK(false) NOT VALID",
  );
  try {
    const response = await mutate(
      "create",
      {
        ...scope,
        creationKey: randomUUID(),
        body: formatUserMention(f.carol.id, "Carol"),
      },
      f.bob,
    );
    expect(response.statusCode, response.body).toBe(500);
    for (const table of [
      "issue_comment",
      "issue_comment_event",
      "issue_comment_mention",
    ])
      expect(
        (
          await f.database.pool.query(
            `SELECT count(*)::int AS count FROM ${table} WHERE issue_id=$1`,
            [issue.id],
          )
        ).rows,
      ).toEqual([{ count: 0 }]);
    expect(
      (
        await f.database.pool.query(
          "SELECT user_id FROM issue_subscription WHERE issue_id=$1",
          [issue.id],
        )
      ).rows,
    ).toEqual([{ user_id: f.alice.id }]);
  } finally {
    await f.database.pool.query(
      "ALTER TABLE issue_subscription DROP CONSTRAINT reject_subscription_test",
    );
  }
});

it("rolls back mention edits and body deletion when their transaction cannot complete", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const original = formatUserMention(f.alice.id, "Alice"),
    comment = await create(scope, original, f.bob),
    input = { ...scope, commentId: comment.id, expectedVersion: 1 };
  await f.database.pool.query(
    "ALTER TABLE issue_comment_mention ADD CONSTRAINT reject_mention_test CHECK(false) NOT VALID",
  );
  try {
    const edit = await mutate(
      "update",
      { ...input, body: formatUserMention(f.carol.id, "Carol") },
      f.bob,
    );
    expect(edit.statusCode, edit.body).toBe(500);
  } finally {
    await f.database.pool.query(
      "ALTER TABLE issue_comment_mention DROP CONSTRAINT reject_mention_test",
    );
  }
  await f.database.pool.query(
    "ALTER TABLE issue_comment_event ADD CONSTRAINT reject_event_test CHECK(false) NOT VALID",
  );
  try {
    const deleted = await mutate("delete", input, f.bob);
    expect(deleted.statusCode, deleted.body).toBe(500);
  } finally {
    await f.database.pool.query(
      "ALTER TABLE issue_comment_event DROP CONSTRAINT reject_event_test",
    );
  }
  const read = await query("get", { ...scope, commentId: comment.id }, f.bob);
  expect(read.statusCode, read.body).toBe(200);
  expect(f.data<IssueComment>(read)).toMatchObject({
    body: original,
    version: 1,
    deletedAt: null,
    mentions: [{ id: f.alice.id, name: "Alice" }],
  });
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment_event WHERE comment_id=$1",
        [comment.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
