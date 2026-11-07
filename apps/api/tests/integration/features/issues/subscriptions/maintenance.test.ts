import { expect, it } from "vitest";
import { useCommentFixture } from "../comments/fixtures.js";
const { f, teams, issues, create } = useCommentFixture();
const set = async (
  scope: { organisationId: string; issueId: string },
  following: boolean,
  actor = f.bob,
) => {
  const r = await f.mutate(
    "organisations.issues.subscriptions.setMine",
    { ...scope, following },
    actor,
  );
  expect(r.statusCode, r.body).toBe(200);
};
const state = async (issueId: string, userId: string) =>
  (
    await f.database.pool.query<{ state: "watching" | "muted" }>(
      "SELECT state FROM issue_subscription WHERE issue_id=$1 AND user_id=$2",
      [issueId, userId],
    )
  ).rows;

it("clears only inaccessible watchers on privacy changes, preserves mutes and never restores a watch just for regained access", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    otherTeam = await teams.create(org, { key: "WEB" });
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    other = await issues.create({
      organisationId: org.id,
      teamId: otherTeam.id,
    });
  const scope = { organisationId: org.id, issueId: issue.id },
    ts = { organisationId: org.id, teamId: team.id };
  await set(scope, true);
  await set(scope, false, f.carol);
  await set({ ...scope, issueId: other.id }, true);
  const changed = await teams.mutate(
    "setVisibility",
    { ...ts, expectedVersion: 1, visibility: "private" },
    f.alice,
  );
  expect(changed.statusCode, changed.body).toBe(200);
  expect(await state(issue.id, f.bob.id)).toEqual([]);
  expect(await state(issue.id, f.carol.id)).toEqual([{ state: "muted" }]);
  expect(await state(issue.id, f.alice.id)).toEqual([{ state: "watching" }]);
  expect(await state(other.id, f.bob.id)).toEqual([{ state: "watching" }]);
  for (const actor of [f.bob, f.carol]) {
    const add = await teams.mutate(
      "members.add",
      { ...ts, userId: actor.id },
      f.alice,
    );
    expect(add.statusCode, add.body).toBe(200);
    const get = await f.query(
      "organisations.issues.subscriptions.getMine",
      scope,
      actor,
    );
    expect(get.statusCode, get.body).toBe(200);
    expect(f.data<{ following: boolean }>(get).following).toBe(false);
    await create(scope, "New participation", actor);
  }
  expect(await state(issue.id, f.bob.id)).toEqual([{ state: "watching" }]);
  expect(await state(issue.id, f.carol.id)).toEqual([{ state: "muted" }]);
  const removed = await f.mutate(
    "organisations.members.remove",
    { organisationId: org.id, userId: f.carol.id },
    f.alice,
  );
  expect(removed.statusCode, removed.body).toBe(200);
  expect(await state(issue.id, f.carol.id)).toEqual([]);
});

it("handles private-team leave/removal and administrator demotion using current effective access", async () => {
  const org = await f.create();
  await f.member(org, f.bob, "admin");
  await f.member(org, f.carol);
  const team = await teams.create(org, { visibility: "private" }),
    ts = { organisationId: org.id, teamId: team.id };
  const add = await teams.mutate(
    "members.add",
    { ...ts, userId: f.carol.id },
    f.alice,
  );
  expect(add.statusCode, add.body).toBe(200);
  const issue = await issues.create(ts, { assigneeId: f.bob.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  await set(scope, true, f.carol);
  const leave = await teams.mutate("leave", ts, f.carol);
  expect(leave.statusCode, leave.body).toBe(200);
  expect(await state(issue.id, f.carol.id)).toEqual([]);
  const removed = await teams.mutate(
    "members.remove",
    { ...ts, userId: f.bob.id },
    f.alice,
  );
  expect(removed.statusCode, removed.body).toBe(200);
  expect(await state(issue.id, f.bob.id)).toEqual([{ state: "watching" }]);
  const demote = await f.mutate(
    "organisations.members.changeRole",
    { organisationId: org.id, userId: f.bob.id, role: "member" },
    f.alice,
  );
  expect(demote.statusCode, demote.body).toBe(200);
  expect(await state(issue.id, f.bob.id)).toEqual([]);
  expect(await state(issue.id, f.alice.id)).toEqual([{ state: "watching" }]);
});
