import { expect, it } from "vitest";
import { useProjectFixture, type Project } from "./fixtures.js";
const { f, teams, create, query, mutate } = useProjectFixture();

it("rolls back creation and association replacement on persistence failure without leaking payloads", async () => {
  const org = await f.create();
  const first = await teams.create(org),
    second = await teams.create(org, { key: "WEB" });
  const project = await create(org, [first.id]);
  await f.database.pool.query(
    "CREATE FUNCTION reject_project_team() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-project-failure'; END;$$; CREATE TRIGGER reject_project_team BEFORE INSERT ON project_team FOR EACH ROW EXECUTE FUNCTION reject_project_team()",
  );
  try {
    const failed = await mutate(
      "create",
      {
        organisationId: org.id,
        name: "Sensitive launch name",
        description: "Sensitive roadmap",
        teamIds: [first.id],
      },
      f.alice,
    );
    expect(failed.statusCode).toBe(500);
    expect(
      (
        await f.database.pool.query(
          "SELECT id FROM project WHERE organisation_id=$1",
          [org.id],
        )
      ).rowCount,
    ).toBe(1);
    const replacement = await mutate(
      "setTeams",
      {
        organisationId: org.id,
        projectId: project.id,
        expectedVersion: 1,
        teamIds: [second.id],
      },
      f.alice,
    );
    expect(replacement.statusCode).toBe(500);
    const saved = f.data<Project>(
      await query(
        "get",
        { organisationId: org.id, projectId: project.id },
        f.alice,
      ),
    );
    expect(saved.version).toBe(1);
    expect(saved.teams.map((t) => t.id)).toEqual([first.id]);
    for (const value of [
      "private-project-failure",
      "Sensitive launch name",
      "Sensitive roadmap",
    ])
      for (const output of [failed.body, replacement.body, f.logLines.join("")])
        expect(output).not.toContain(value);
  } finally {
    await f.database.pool.query(
      "DROP TRIGGER reject_project_team ON project_team; DROP FUNCTION reject_project_team()",
    );
  }
});
