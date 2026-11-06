import { expect, it } from "vitest";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, get, mutate } = useIssueFixture();

it("rolls back issue/counter/history writes together and keeps database failures private", async () => {
  const org = await f.create(),
    team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const install = () =>
    f.database.pool.query(
      "CREATE FUNCTION reject_issue_activity() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-activity-failure'; END;$$; CREATE TRIGGER reject_issue_activity BEFORE INSERT ON issue_activity FOR EACH ROW EXECUTE FUNCTION reject_issue_activity()",
    );
  const uninstall = () =>
    f.database.pool.query(
      "DROP TRIGGER reject_issue_activity ON issue_activity; DROP FUNCTION reject_issue_activity()",
    );
  await install();
  try {
    const response = await mutate(
      "create",
      { ...scope, title: "Sensitive title", description: "Secret Markdown" },
      f.alice,
    );
    expect(response.statusCode).toBe(500);
    for (const table of ["issue", "issue_counter", "issue_activity"])
      expect(
        (
          await f.database.pool.query(
            `SELECT 1 FROM ${table} WHERE organisation_id=$1`,
            [org.id],
          )
        ).rowCount,
      ).toBe(0);
    expect(response.body).not.toContain("private-activity-failure");
  } finally {
    await uninstall();
  }
  const value = await create(scope);
  expect(value.identifier).toBe("ENG-1");
  await install();
  try {
    const response = await mutate(
      "update",
      {
        organisationId: org.id,
        issueId: value.id,
        expectedVersion: 1,
        title: "Sensitive update",
        description: "Secret update",
      },
      f.alice,
    );
    expect(response.statusCode).toBe(500);
    expect(await get({ organisationId: org.id, issueId: value.id })).toEqual(
      value,
    );
    expect(
      (
        await f.database.pool.query(
          "SELECT count(*)::int AS count FROM issue_activity WHERE issue_id=$1",
          [value.id],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  } finally {
    await uninstall();
  }
  const logs = f.logLines.join("");
  for (const secret of [
    "Sensitive title",
    "Secret Markdown",
    "Sensitive update",
    "Secret update",
    "private-activity-failure",
  ])
    expect(logs).not.toContain(secret);
});

it("handles counter and version exhaustion with safe conflicts and no partial writes", async () => {
  const org = await f.create(),
    team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const value = await create(scope);
  await f.database.pool.query(
    "UPDATE issue_counter SET last_number=2147483647 WHERE team_id=$1",
    [team.id],
  );
  expect(
    (await mutate("create", { ...scope, title: "Exhausted" }, f.alice))
      .statusCode,
  ).toBe(409);
  await f.database.pool.query(
    "UPDATE issue SET version=2147483647 WHERE id=$1",
    [value.id],
  );
  const response = await mutate(
    "update",
    {
      organisationId: org.id,
      issueId: value.id,
      expectedVersion: 2147483647,
      title: "Cannot persist",
    },
    f.alice,
  );
  expect(response.statusCode).toBe(409);
  expect(await get({ organisationId: org.id, issueId: value.id })).toEqual({
    ...value,
    version: 2147483647,
  });
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_activity WHERE issue_id=$1",
        [value.id],
      )
    ).rows,
  ).toEqual([{ count: 1 }]);
});
