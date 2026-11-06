import { expect, it } from "vitest";
import { useTeamFixture } from "./fixtures.js";
const { f, mutate } = useTeamFixture();
it("rolls back team creation when the initial maintainer cannot be persisted and keeps errors private", async () => {
  const org = await f.create();
  await f.database.pool.query(
    "CREATE FUNCTION reject_team_member() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-team-failure'; END;$$; CREATE TRIGGER reject_team_member BEFORE INSERT ON team_member FOR EACH ROW EXECUTE FUNCTION reject_team_member()",
  );
  try {
    const response = await mutate(
      "create",
      {
        organisationId: org.id,
        key: "FAIL",
        name: "Sensitive team name",
        description: "Private description",
      },
      f.alice,
    );
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("private-team-failure");
    expect(
      (
        await f.database.pool.query(
          "SELECT id FROM team WHERE organisation_id=$1",
          [org.id],
        )
      ).rowCount,
    ).toBe(0);
    const logs = f.logLines.join("");
    for (const value of [
      "private-team-failure",
      "Sensitive team name",
      "Private description",
    ])
      expect(logs).not.toContain(value);
  } finally {
    await f.database.pool.query(
      "DROP TRIGGER reject_team_member ON team_member; DROP FUNCTION reject_team_member()",
    );
  }
});
