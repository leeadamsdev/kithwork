import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, get } = useIssueFixture();

it("clears assignments in archived teams on owner demotion while retaining explicit private-team membership", async () => {
  const org = await f.create();
  await f.member(org, f.carol, "owner");
  const implicit = await teams.create(org, { visibility: "private" }),
    explicit = await teams.create(org, { key: "EXP", visibility: "private" });
  expect(
    (
      await teams.mutate(
        "members.add",
        { organisationId: org.id, teamId: explicit.id, userId: f.carol.id },
        f.alice,
      )
    ).statusCode,
  ).toBe(200);
  const first = await create(
      { organisationId: org.id, teamId: implicit.id },
      { assigneeId: f.carol.id },
    ),
    second = await create(
      { organisationId: org.id, teamId: explicit.id },
      { assigneeId: f.carol.id },
    );
  expect(
    (
      await teams.mutate(
        "archive",
        { organisationId: org.id, teamId: implicit.id, expectedVersion: 1 },
        f.alice,
      )
    ).statusCode,
  ).toBe(200);
  const response = await f.mutate(
    "organisations.members.changeRole",
    { organisationId: org.id, userId: f.carol.id, role: "member" },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(
    await get({ organisationId: org.id, issueId: first.id }),
  ).toMatchObject({ assigneeId: null, version: 2 });
  expect(
    await get({ organisationId: org.id, issueId: second.id }),
  ).toMatchObject({ assigneeId: f.carol.id, version: 1 });
});

it("rolls back role demotion and invitation cancellation together with failed assignment history", async () => {
  const org = await f.create();
  await f.member(org, f.carol, "admin");
  const team = await teams.create(org, { visibility: "private" });
  const issue = await create(
    { organisationId: org.id, teamId: team.id },
    { assigneeId: f.carol.id },
  );
  const invited = await f.mutate(
    "organisations.invitations.create",
    {
      organisationId: org.id,
      email: randomUUID() + "@example.test",
      role: "member",
    },
    f.carol,
  );
  expect(invited.statusCode, invited.body).toBe(200);
  const invitation = f.data<{ id: string }>(invited);
  await f.database.pool.query(
    "ALTER TABLE issue_activity ADD CONSTRAINT reject_demotion_test CHECK (kind <> 'assignment_cleared') NOT VALID",
  );
  try {
    const response = await f.mutate(
      "organisations.members.changeRole",
      { organisationId: org.id, userId: f.carol.id, role: "member" },
      f.alice,
    );
    expect(response.statusCode, response.body).toBe(500);
    expect(
      await get({ organisationId: org.id, issueId: issue.id }, f.carol),
    ).toMatchObject({ assigneeId: f.carol.id, version: 1 });
    expect(
      (
        await f.database.pool.query<{ role: string }>(
          "SELECT role FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
          [org.id, f.carol.id],
        )
      ).rows,
    ).toEqual([{ role: "admin" }]);
    expect(
      (
        await f.database.pool.query<{ status: string }>(
          "SELECT status FROM organisation_invitation WHERE id=$1",
          [invitation.id],
        )
      ).rows,
    ).toEqual([{ status: "pending" }]);
  } finally {
    await f.database.pool.query(
      "ALTER TABLE issue_activity DROP CONSTRAINT reject_demotion_test",
    );
  }
});
