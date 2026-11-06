import { expect, it } from "vitest";
import type { IssueActivityPage, IssueDetail } from "@kithwork/contracts";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, get, query, mutate } = useIssueFixture();

it.each([false, true])(
  "clears every assignment before organisation departure, including archived issues (leave=%s)",
  async (leaving) => {
    const org = await f.create();
    await f.member(org, f.bob);
    const team = await teams.create(org),
      scope = { organisationId: org.id, teamId: team.id };
    const active = await create(scope, { assigneeId: f.bob.id }),
      archived = await create(scope, { assigneeId: f.bob.id });
    expect(
      (
        await mutate(
          "archive",
          { organisationId: org.id, issueId: archived.id, expectedVersion: 1 },
          f.alice,
        )
      ).statusCode,
    ).toBe(200);
    const response = await f.mutate(
      leaving ? "organisations.leave" : "organisations.members.remove",
      { organisationId: org.id, ...(leaving ? {} : { userId: f.bob.id }) },
      leaving ? f.bob : f.alice,
    );
    expect(response.statusCode, response.body).toBe(200);
    for (const [issue, version] of [
      [active, 2],
      [archived, 3],
    ] as const) {
      expect(
        await get({ organisationId: org.id, issueId: issue.id }),
      ).toMatchObject({ assigneeId: null, assignee: null, version });
      const page = f.data<IssueActivityPage>(
        await query(
          "activity.list",
          { organisationId: org.id, issueId: issue.id },
          f.alice,
        ),
      );
      expect(page.items.at(-1)).toMatchObject({
        kind: "assignment_cleared",
        cause: leaving
          ? "organisation_member_left"
          : "organisation_member_removed",
        actor: { id: leaving ? f.bob.id : f.alice.id },
        changes: {
          assignee: { from: { id: f.bob.id, name: "Bob" }, to: null },
        },
      });
    }
    expect(
      (
        await mutate(
          "update",
          {
            organisationId: org.id,
            issueId: active.id,
            expectedVersion: 1,
            title: "Stale",
          },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await query(
          "get",
          { organisationId: org.id, issueId: active.id },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
    await f.member(org, f.bob);
    expect(
      (await get({ organisationId: org.id, issueId: active.id })).assigneeId,
    ).toBeNull();
  },
);

it.each([false, true])(
  "clears private-team assignments after membership loss but preserves implicit administrator and public access (leave=%s)",
  async (leaving) => {
    const org = await f.create();
    await f.member(org, f.bob);
    await f.member(org, f.carol, "admin");
    const privateTeam = await teams.create(org, { visibility: "private" }),
      publicTeam = await teams.create(org, { key: "PUB" });
    const privateScope = { organisationId: org.id, teamId: privateTeam.id },
      publicScope = { organisationId: org.id, teamId: publicTeam.id };
    for (const actor of [f.bob, f.carol])
      for (const scope of [privateScope, publicScope])
        expect(
          (
            await teams.mutate(
              "members.add",
              { ...scope, userId: actor.id },
              f.alice,
            )
          ).statusCode,
        ).toBe(200);
    const privateIssue = await create(privateScope, { assigneeId: f.bob.id }),
      publicIssue = await create(publicScope, { assigneeId: f.bob.id }),
      adminIssue = await create(privateScope, { assigneeId: f.carol.id });
    for (const [scope, actor] of [
      [privateScope, f.bob],
      [publicScope, f.bob],
      [privateScope, f.carol],
    ] as const) {
      const response = await teams.mutate(
        leaving ? "leave" : "members.remove",
        { ...scope, ...(leaving ? {} : { userId: actor.id }) },
        leaving ? actor : f.alice,
      );
      expect(response.statusCode, response.body).toBe(200);
    }
    expect(
      await get({ organisationId: org.id, issueId: privateIssue.id }),
    ).toMatchObject({ assigneeId: null, version: 2 });
    for (const value of [publicIssue, adminIssue])
      expect(
        await get({ organisationId: org.id, issueId: value.id }),
      ).toMatchObject({ assigneeId: value.assigneeId, version: 1 });
    const history = f.data<IssueActivityPage>(
      await query(
        "activity.list",
        { organisationId: org.id, issueId: privateIssue.id },
        f.alice,
      ),
    );
    expect(history.items.at(-1)!.cause).toBe(
      leaving ? "team_member_left" : "team_member_removed",
    );
  },
);

it("clears only newly inaccessible assignments when a team becomes private or an administrator is demoted", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol, "admin");
  const team = await teams.create(org),
    scope = { organisationId: org.id, teamId: team.id };
  const bob = await create(scope, { assigneeId: f.bob.id }),
    admin = await create(scope, { assigneeId: f.carol.id }),
    owner = await create(scope, { assigneeId: f.alice.id });
  let response = await teams.mutate(
    "setVisibility",
    { ...scope, expectedVersion: 1, visibility: "private" },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(await get({ organisationId: org.id, issueId: bob.id })).toMatchObject({
    version: 2,
    assigneeId: null,
  });
  expect(
    await get({ organisationId: org.id, issueId: admin.id }),
  ).toMatchObject({ version: 1, assigneeId: f.carol.id });
  expect(
    await get({ organisationId: org.id, issueId: owner.id }),
  ).toMatchObject({ version: 1, assigneeId: f.alice.id });
  const publicTeam = await teams.create(org, { key: "PUB" }),
    publicIssue = await create(
      { organisationId: org.id, teamId: publicTeam.id },
      { assigneeId: f.carol.id },
    );
  const memberTeam = await teams.create(org, {
    key: "EXP",
    visibility: "private",
  });
  await teams.mutate(
    "members.add",
    { organisationId: org.id, teamId: memberTeam.id, userId: f.carol.id },
    f.alice,
  );
  const explicitIssue = await create(
    { organisationId: org.id, teamId: memberTeam.id },
    { assigneeId: f.carol.id },
  );
  response = await f.mutate(
    "organisations.members.changeRole",
    { organisationId: org.id, userId: f.carol.id, role: "member" },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(
    await get({ organisationId: org.id, issueId: admin.id }),
  ).toMatchObject({ version: 2, assigneeId: null });
  for (const value of [publicIssue, explicitIssue])
    expect(
      await get({ organisationId: org.id, issueId: value.id }),
    ).toMatchObject({ version: 1, assigneeId: f.carol.id });
  expect(
    f
      .data<IssueActivityPage>(
        await query(
          "activity.list",
          { organisationId: org.id, issueId: admin.id },
          f.alice,
        ),
      )
      .items.at(-1)!.cause,
  ).toBe("organisation_role_changed");
  expect(
    f
      .data<IssueActivityPage>(
        await query(
          "activity.list",
          { organisationId: org.id, issueId: bob.id },
          f.alice,
        ),
      )
      .items.at(-1)!.cause,
  ).toBe("team_visibility_changed");
  expect(
    (
      await teams.mutate(
        "setVisibility",
        { ...scope, expectedVersion: 2, visibility: "organisation" },
        f.alice,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await get({ organisationId: org.id, issueId: bob.id })).assigneeId,
  ).toBeNull();
});

it("rolls back surrounding administration when one affected issue has exhausted its version", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    scope = { organisationId: org.id, teamId: team.id };
  const first = await create(scope, { assigneeId: f.bob.id }),
    exhausted = await create(scope, { assigneeId: f.bob.id });
  await f.database.pool.query(
    "UPDATE issue SET version=2147483647 WHERE id=$1",
    [exhausted.id],
  );
  const response = await teams.mutate(
    "setVisibility",
    { ...scope, expectedVersion: 1, visibility: "private" },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(409);
  expect(
    await get({ organisationId: org.id, issueId: first.id }),
  ).toMatchObject({ version: 1, assigneeId: f.bob.id });
  expect((await teams.query("get", scope, f.bob)).statusCode).toBe(200);
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_activity WHERE issue_id=ANY($1::uuid[])",
        [[first.id, exhausted.id]],
      )
    ).rows,
  ).toEqual([{ count: 2 }]);
  const remove = await f.mutate(
    "organisations.members.remove",
    { organisationId: org.id, userId: f.bob.id },
    f.alice,
  );
  expect(remove.statusCode, remove.body).toBe(409);
  expect(
    (await query("get", { organisationId: org.id, issueId: first.id }, f.bob))
      .statusCode,
  ).toBe(200);
});

it("rolls back a membership deletion and all assignment changes if history cannot be recorded", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const issue = await create(
    { organisationId: org.id, teamId: team.id },
    { assigneeId: f.bob.id },
  );
  await f.database.pool.query(
    "ALTER TABLE issue_activity ADD CONSTRAINT reject_cleanup_test CHECK (kind <> 'assignment_cleared') NOT VALID",
  );
  try {
    const response = await f.mutate(
      "organisations.members.remove",
      { organisationId: org.id, userId: f.bob.id },
      f.alice,
    );
    expect(response.statusCode, response.body).toBe(500);
    const read = await query(
      "get",
      { organisationId: org.id, issueId: issue.id },
      f.bob,
    );
    expect(read.statusCode, read.body).toBe(200);
    expect(f.data<IssueDetail>(read)).toMatchObject({
      version: 1,
      assigneeId: f.bob.id,
    });
  } finally {
    await f.database.pool.query(
      "ALTER TABLE issue_activity DROP CONSTRAINT reject_cleanup_test",
    );
  }
});
