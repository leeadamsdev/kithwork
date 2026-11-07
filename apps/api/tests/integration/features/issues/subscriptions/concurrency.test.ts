import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import * as events from "../../../../../src/features/issues/comments/events.js";
import { formatUserMention } from "@kithwork/contracts";
import { useCommentFixture } from "../comments/fixtures.js";
const { f, teams, issues, create, mutate } = useCommentFixture();
const waitForLocks = async (count: number, mode = "update") =>
  expect
    .poll(
      async () =>
        (
          await f.database.pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND lower(query) LIKE $1",
            [`%for ${mode}%`],
          )
        ).rows[0]!.count,
      { timeout: 1500, interval: 10 },
    )
    .toBe(count);

it("orders an explicit unfollow after a pending comment's automatic follow", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const release = Promise.withResolvers<void>();
  let entered = false;
  const original = events.appendCommentEvent;
  const spy = vi
    .spyOn(events, "appendCommentEvent")
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      entered = true;
      await release.promise;
    });
  const posting = create(scope, "Participate", f.bob);
  let pending: ReturnType<typeof f.mutate> | undefined;
  try {
    await expect.poll(() => entered).toBe(true);
    pending = f.mutate(
      "organisations.issues.subscriptions.setMine",
      { ...scope, following: false },
      f.bob,
    );
    await waitForLocks(1);
    release.resolve();
    await posting;
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(
      (
        await f.database.pool.query(
          "SELECT state FROM issue_subscription WHERE issue_id=$1 AND user_id=$2",
          [issue.id, f.bob.id],
        )
      ).rows,
    ).toEqual([{ state: "muted" }]);
  } finally {
    release.resolve();
    await Promise.all([posting, pending]);
    spy.mockRestore();
  }
});

it("does not override a mute when a later comment waits behind the same issue lock", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const blocker = await f.database.pool.connect();
  let unfollow: ReturnType<typeof f.mutate> | undefined,
    posting: ReturnType<typeof mutate> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM issue WHERE id=$1 FOR UPDATE", [
      issue.id,
    ]);
    unfollow = f.mutate(
      "organisations.issues.subscriptions.setMine",
      { ...scope, following: false },
      f.bob,
    );
    await waitForLocks(1);
    posting = mutate(
      "create",
      { ...scope, creationKey: randomUUID(), body: "Later participation" },
      f.bob,
    );
    await waitForLocks(2);
    await blocker.query("COMMIT");
    for (const response of await Promise.all([unfollow, posting]))
      expect(response.statusCode, response.body).toBe(200);
    expect(
      (
        await f.database.pool.query(
          "SELECT state FROM issue_subscription WHERE issue_id=$1 AND user_id=$2",
          [issue.id, f.bob.id],
        )
      ).rows,
    ).toEqual([{ state: "muted" }]);
  } finally {
    await blocker.query("ROLLBACK");
    await Promise.all([unfollow, posting]);
    blocker.release();
  }
});

it("uses current mention-target eligibility after an exclusive permission change commits", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org, { visibility: "private" }),
    ts = { organisationId: org.id, teamId: team.id };
  for (const actor of [f.bob, f.carol]) {
    const r = await teams.mutate(
      "members.add",
      { ...ts, userId: actor.id },
      f.alice,
    );
    expect(r.statusCode, r.body).toBe(200);
  }
  const issue = await issues.create(ts),
    scope = { organisationId: org.id, issueId: issue.id };
  const blocker = await f.database.pool.connect();
  let posting: ReturnType<typeof mutate> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM organisation WHERE id=$1 FOR UPDATE", [
      org.id,
    ]);
    posting = mutate(
      "create",
      {
        ...scope,
        creationKey: randomUUID(),
        body: formatUserMention(f.carol.id, "Carol"),
      },
      f.bob,
    );
    await waitForLocks(1, "share");
    await blocker.query(
      "DELETE FROM team_member WHERE team_id=$1 AND user_id=$2",
      [team.id, f.carol.id],
    );
    await blocker.query("COMMIT");
    const response = await posting;
    expect(response.statusCode, response.body).toBe(404);
    expect(
      (
        await f.database.pool.query(
          "SELECT count(*)::int AS count FROM issue_comment WHERE issue_id=$1",
          [issue.id],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    await blocker.query("ROLLBACK");
    await posting;
    blocker.release();
  }
});

it("initialises an unchanged legacy comment only once under simultaneous retries", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const body = formatUserMention(f.alice.id, "Self"),
    comment = await create(scope, body);
  await f.database.pool.query(
    "DELETE FROM issue_comment_mention WHERE comment_id=$1",
    [comment.id],
  );
  await f.database.pool.query(
    "UPDATE issue_comment SET mentions_initialised=false WHERE id=$1",
    [comment.id],
  );
  const input = { ...scope, commentId: comment.id, expectedVersion: 1, body };
  const responses = await Promise.all([
    mutate("update", input, f.alice),
    mutate("update", input, f.alice),
  ]);
  for (const r of responses) expect(r.statusCode, r.body).toBe(200);
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment_mention WHERE comment_id=$1",
        [comment.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment_event WHERE comment_id=$1",
        [comment.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
