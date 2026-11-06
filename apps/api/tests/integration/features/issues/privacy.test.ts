import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, query, mutate } = useIssueFixture();

it("keeps identifiers, filters, history and writes scoped to current team access", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol, "admin");
  const shared = await teams.create(org),
    hidden = await teams.create(org, { key: "SEC", visibility: "private" });
  const publicIssue = await create({
    organisationId: org.id,
    teamId: shared.id,
  });
  const privateIssue = await create({
    organisationId: org.id,
    teamId: hidden.id,
  });
  const scope = { organisationId: org.id, issueId: privateIssue.id };
  for (const [path, input] of [
    ["get", scope],
    ["getByIdentifier", { organisationId: org.id, identifier: "SEC-1" }],
    ["activity.list", scope],
    ["list", { organisationId: org.id, teamId: hidden.id }],
    ["list", { organisationId: org.id, statusId: privateIssue.statusId }],
  ] as const)
    expect((await query(path, input, f.bob)).statusCode).toBe(404);
  expect((await query("get", scope)).statusCode).toBe(401);
  expect((await query("get", scope, f.carol)).statusCode).toBe(200);
  expect(
    (
      await mutate(
        "update",
        { ...scope, expectedVersion: 1, title: "Denied" },
        f.bob,
      )
    ).statusCode,
  ).toBe(404);
  for (const statusId of [privateIssue.statusId, randomUUID()])
    expect(
      (
        await mutate(
          "create",
          {
            organisationId: org.id,
            teamId: shared.id,
            title: "Invalid status",
            statusId,
          },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
  const other = await f.create();
  const foreign = await teams.create(other);
  const foreignIssue = await create({
    organisationId: other.id,
    teamId: foreign.id,
  });
  expect(foreignIssue.identifier).toBe(publicIssue.identifier);
  expect(
    (
      await query(
        "get",
        { organisationId: org.id, issueId: foreignIssue.id },
        f.alice,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await mutate(
        "update",
        {
          organisationId: org.id,
          issueId: publicIssue.id,
          expectedVersion: 1,
          statusId: foreignIssue.statusId,
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await f.database.pool.query(
        "SELECT last_number FROM issue_counter WHERE team_id=$1",
        [shared.id],
      )
    ).rows,
  ).toEqual([{ last_number: 1 }]);
  await teams.mutate(
    "members.add",
    {
      organisationId: org.id,
      teamId: hidden.id,
      userId: f.bob.id,
      role: "maintainer",
    },
    f.alice,
  );
  expect(
    (await mutate("archive", { ...scope, expectedVersion: 1 }, f.bob))
      .statusCode,
  ).toBe(200);
  await teams.mutate(
    "members.remove",
    { organisationId: org.id, teamId: hidden.id, userId: f.bob.id },
    f.alice,
  );
  expect((await query("get", scope, f.bob)).statusCode).toBe(404);
});
