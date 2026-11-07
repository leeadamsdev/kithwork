import { createHash, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import * as mentionCommands from "../../../../../src/features/issues/comments/mentions.js";
import { formatUserMention, type IssueComment } from "@kithwork/contracts";
import { useCommentFixture } from "./fixtures.js";
const { f, teams, issues, create, query, mutate } = useCommentFixture();

it("reports first-time identities once without following a mention recipient", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const first: string[][] = [],
    original = mentionCommands.syncCommentMentions;
  const spy = vi
    .spyOn(mentionCommands, "syncCommentMentions")
    .mockImplementation(async (...args) => {
      const result = await original(...args);
      first.push(result.firstMentionUserIds);
      return result;
    });
  try {
    const body = formatUserMention(f.bob.id, "Bob"),
      comment = await create(scope, body);
    for (const [expectedVersion, next] of [
      [1, body + " Text"],
      [2, "Removed"],
      [3, body],
    ] as const) {
      const response = await mutate(
        "update",
        { ...scope, commentId: comment.id, expectedVersion, body: next },
        f.alice,
      );
      expect(response.statusCode, response.body).toBe(200);
    }
    expect(first).toEqual([[f.bob.id], [], [], []]);
    const following = await f.query(
      "organisations.issues.subscriptions.getMine",
      scope,
      f.bob,
    );
    expect(following.statusCode, following.body).toBe(200);
    expect(f.data<{ following: boolean }>(following).following).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it("resolves mention identities independently of labels and retains first-use history across removal and reactivation", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id };
  const body = formatUserMention(f.carol.id, "Forged Alice");
  const comment = await create(scope, body, f.bob);
  expect(comment.mentions).toEqual([{ id: f.carol.id, name: "Carol" }]);
  const key = { ...scope, commentId: comment.id };
  const edit = async (version: number, next: string) => {
    const response = await mutate(
      "update",
      { ...key, expectedVersion: version, body: next },
      f.bob,
    );
    expect(response.statusCode, response.body).toBe(200);
    return f.data<IssueComment>(response);
  };
  await f.mutate(
    "organisations.members.remove",
    { organisationId: org.id, userId: f.carol.id },
    f.alice,
  );
  expect((await edit(1, body + " retained")).mentions).toEqual([
    { id: f.carol.id, name: "Carol" },
  ]);
  expect((await edit(2, "Removed")).mentions).toEqual([]);
  const denied = await mutate(
    "update",
    { ...key, expectedVersion: 3, body },
    f.bob,
  );
  expect(denied.statusCode, denied.body).toBe(404);
  await f.member(org, f.carol);
  expect((await edit(3, body)).mentions).toEqual([
    { id: f.carol.id, name: "Carol" },
  ]);
  expect(
    (
      await f.database.pool.query(
        "SELECT first_mentioned_version,active FROM issue_comment_mention WHERE comment_id=$1",
        [comment.id],
      )
    ).rows,
  ).toEqual([{ first_mentioned_version: 1, active: true }]);
  const removed = await mutate("delete", { ...key, expectedVersion: 4 }, f.bob);
  expect(removed.statusCode, removed.body).toBe(200);
  expect(f.data<IssueComment>(removed)).toMatchObject({
    body: null,
    mentions: [],
  });
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment_mention WHERE comment_id=$1",
        [comment.id],
      )
    ).rows,
  ).toEqual([{ count: 0 }]);
  expect((await issues.get(scope)).version).toBe(1);
});

it("rejects new malformed or inaccessible mentions atomically without following the mentioned person", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org, { visibility: "private" });
  await teams.mutate(
    "members.add",
    { organisationId: org.id, teamId: team.id, userId: f.bob.id },
    f.alice,
  );
  const issue = await issues.create({
    organisationId: org.id,
    teamId: team.id,
  });
  const scope = { organisationId: org.id, issueId: issue.id };
  for (const [body, status] of [
    ["[Bad](kithwork://user/nope)", 400],
    [formatUserMention(f.carol.id, "Carol"), 404],
  ] as const) {
    const response = await mutate(
      "create",
      { ...scope, creationKey: randomUUID(), body },
      f.bob,
    );
    expect(response.statusCode, response.body).toBe(status);
  }
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment WHERE issue_id=$1",
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
  const comment = await create(
    scope,
    formatUserMention(f.alice.id, "Owner"),
    f.bob,
  );
  expect(comment.mentions).toEqual([{ id: f.alice.id, name: "Alice" }]);
  expect(JSON.stringify(comment)).not.toContain(f.alice.email);
  expect(
    (
      await f.database.pool.query(
        "SELECT user_id FROM issue_subscription WHERE issue_id=$1 ORDER BY user_id",
        [issue.id],
      )
    ).rows,
  ).toEqual([f.alice.id, f.bob.id].sort().map((user_id) => ({ user_id })));
});

it("converts legacy bodies silently, lets authors remove invalid old links and preserves original-key retries", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id },
    creationKey = randomUUID();
  const comment = await create(scope, "Before rollout", f.bob, creationKey);
  const legacy = [
    formatUserMention(f.alice.id, "Old"),
    ...Array.from({ length: 20 }, () => formatUserMention(randomUUID(), "Old")),
    "[Old malformed](kithwork:bad)",
  ].join(" ");
  await f.database.pool.query(
    "UPDATE issue_comment SET body=$1,creation_hash=$2,mentions_initialised=false WHERE id=$3",
    [legacy, createHash("sha256").update(legacy).digest("hex"), comment.id],
  );
  const input = { ...scope, commentId: comment.id, expectedVersion: 1 };
  expect(
    (await query("get", { ...scope, commentId: comment.id }, f.bob)).statusCode,
  ).toBe(200);
  expect(
    (await mutate("update", { ...input, body: legacy }, f.bob)).statusCode,
  ).toBe(400);
  expect(
    (
      await f.database.pool.query(
        "SELECT mentions_initialised FROM issue_comment WHERE id=$1",
        [comment.id],
      )
    ).rows,
  ).toEqual([{ mentions_initialised: false }]);
  const corrected = await mutate(
    "update",
    {
      ...input,
      body:
        formatUserMention(f.alice.id, "Old") +
        " " +
        formatUserMention(f.carol.id, "New"),
    },
    f.bob,
  );
  expect(corrected.statusCode, corrected.body).toBe(200);
  expect(
    (
      await f.database.pool.query(
        "SELECT user_id,first_mentioned_version FROM issue_comment_mention WHERE comment_id=$1 ORDER BY user_id",
        [comment.id],
      )
    ).rows,
  ).toEqual(
    [
      { user_id: f.alice.id, first_mentioned_version: 1 },
      { user_id: f.carol.id, first_mentioned_version: 2 },
    ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
  );
  const retry = await mutate(
    "create",
    { ...scope, creationKey, body: legacy },
    f.bob,
  );
  expect(retry.statusCode, retry.body).toBe(200);
  expect(f.data<IssueComment>(retry)).toEqual(f.data<IssueComment>(corrected));
});

it("initialises a valid unchanged legacy body without another comment version or event", async () => {
  const org = await f.create();
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id },
    body = formatUserMention(f.alice.id, "Self");
  const comment = await create(scope, body);
  await f.database.pool.query(
    "DELETE FROM issue_comment_mention WHERE comment_id=$1",
    [comment.id],
  );
  await f.database.pool.query(
    "UPDATE issue_comment SET mentions_initialised=false WHERE id=$1",
    [comment.id],
  );
  const response = await mutate(
    "update",
    { ...scope, commentId: comment.id, expectedVersion: 1, body },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(f.data<IssueComment>(response)).toMatchObject({
    version: 1,
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
