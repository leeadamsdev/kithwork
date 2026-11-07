import { expect, it } from "vitest";
import { useCommentFixture } from "../comments/fixtures.js";
const { f, teams, issues, create, mutate } = useCommentFixture();
const following = async (
  input: { organisationId: string; issueId: string },
  actor = f.alice,
) => {
  const response = await f.query(
    "organisations.issues.subscriptions.getMine",
    input,
    actor,
  );
  expect(response.statusCode, response.body).toBe(200);
  return f.data<{ following: boolean }>(response).following;
};
const set = async (
  scope: { organisationId: string; issueId: string },
  value: boolean,
  actor = f.alice,
) => {
  const response = await f.mutate(
    "organisations.issues.subscriptions.setMine",
    { ...scope, following: value },
    actor,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(f.data<{ following: boolean }>(response).following).toBe(value);
};

it("automatically follows participation without overriding explicit opt-out or advancing issue versions", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    issue = await issues.create(
      { organisationId: org.id, teamId: team.id },
      { assigneeId: f.bob.id },
    );
  const scope = { organisationId: org.id, issueId: issue.id };
  expect(await following(scope)).toBe(true);
  expect(await following(scope, f.bob)).toBe(true);
  expect(await following(scope, f.carol)).toBe(false);
  await set(scope, true, f.carol);
  await set(scope, true, f.carol);
  await set(scope, false, f.bob);
  const comment = await create(scope, "Participate", f.bob);
  expect(await following(scope, f.bob)).toBe(false);
  await issues.mutate(
    "update",
    { ...scope, expectedVersion: 1, assigneeId: f.carol.id },
    f.alice,
  );
  await issues.mutate(
    "update",
    { ...scope, expectedVersion: 2, assigneeId: f.bob.id },
    f.alice,
  );
  expect(await following(scope, f.bob)).toBe(false);
  expect(await following(scope, f.carol)).toBe(true);
  await mutate(
    "delete",
    { ...scope, commentId: comment.id, expectedVersion: 1 },
    f.bob,
  );
  expect(await following(scope, f.bob)).toBe(false);
  await set(scope, false);
  await set(scope, false);
  await create(scope, "Still muted");
  expect(await following(scope)).toBe(false);
  expect((await issues.get(scope)).version).toBe(3);
  await issues.mutate("archive", { ...scope, expectedVersion: 3 }, f.alice);
  await set(scope, true, f.bob);
  expect(await following(scope, f.bob)).toBe(true);
  expect((await issues.get(scope)).version).toBe(4);
});

it("keeps subscriptions private to their owner and requires current parent access", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org, { visibility: "private" }),
    issue = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id };
  expect(
    (await f.query("organisations.issues.subscriptions.getMine", scope, f.bob))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await f.mutate(
        "organisations.issues.subscriptions.setMine",
        { ...scope, following: true },
        f.bob,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await f.mutate(
        "organisations.issues.subscriptions.setMine",
        { ...scope, following: false, userId: f.bob.id },
        f.alice,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (await f.query("organisations.issues.subscriptions.getMine", scope))
      .statusCode,
  ).toBe(401);
  const other = await f.create(f.alice, "Other");
  expect(
    (
      await f.query(
        "organisations.issues.subscriptions.getMine",
        { ...scope, organisationId: other.id },
        f.alice,
      )
    ).statusCode,
  ).toBe(404);
});
