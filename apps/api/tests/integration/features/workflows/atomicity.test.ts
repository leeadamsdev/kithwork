import { expect, it } from "vitest";
import { useWorkflowFixture } from "./fixtures.js";

const { f, teams, get, mutate } = useWorkflowFixture();

it("rolls back team, maintainer and workflow bootstrap if a default status fails", async () => {
  const org = await f.create();
  await f.database.pool.query(
    "CREATE FUNCTION reject_workflow_status() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-status-failure'; END;$$; CREATE TRIGGER reject_workflow_status BEFORE INSERT ON workflow_status FOR EACH ROW EXECUTE FUNCTION reject_workflow_status()",
  );
  try {
    const response = await teams.mutate(
      "create",
      { organisationId: org.id, key: "FAIL", name: "Sensitive bootstrap" },
      f.alice,
    );
    expect(response.statusCode).toBe(500);
    for (const table of [
      "team",
      "team_member",
      "team_workflow",
      "workflow_status",
    ])
      expect(
        (
          await f.database.pool.query(
            `SELECT 1 FROM ${table} WHERE organisation_id=$1`,
            [org.id],
          )
        ).rowCount,
      ).toBe(0);
    expect(response.body).not.toContain("private-status-failure");
    for (const secret of ["private-status-failure", "Sensitive bootstrap"])
      expect(f.logLines.join("")).not.toContain(secret);
  } finally {
    await f.database.pool.query(
      "DROP TRIGGER reject_workflow_status ON workflow_status; DROP FUNCTION reject_workflow_status()",
    );
  }
});

it("retains the old default and version if setting its replacement fails", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const original = await get(scope);
  const todo = original.statuses.find((s) => s.category === "unstarted")!;
  await f.database.pool.query(
    "CREATE FUNCTION reject_workflow_default() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.is_default THEN RAISE EXCEPTION 'private-default-failure'; END IF; RETURN NEW; END;$$; CREATE TRIGGER reject_workflow_default BEFORE UPDATE ON workflow_status FOR EACH ROW EXECUTE FUNCTION reject_workflow_default()",
  );
  try {
    const response = await mutate(
      "setDefault",
      { ...scope, expectedWorkflowVersion: 1, statusId: todo.id },
      f.alice,
    );
    expect(response.statusCode).toBe(500);
    expect(await get(scope)).toEqual(original);
    expect(response.body).not.toContain("private-default-failure");
    expect(f.logLines.join("")).not.toContain("private-default-failure");
  } finally {
    await f.database.pool.query(
      "DROP TRIGGER reject_workflow_default ON workflow_status; DROP FUNCTION reject_workflow_default()",
    );
  }
});
