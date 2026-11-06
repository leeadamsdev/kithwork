import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";

it("backs assignment membership and exact project/team participation with non-cascading foreign keys", async () => {
  const db = await createTestDatabase({ migrate: true });
  try {
    const org = randomUUID(),
      other = randomUUID(),
      team = randomUUID(),
      status = randomUUID(),
      alice = randomUUID(),
      bob = randomUUID(),
      project = randomUUID(),
      foreignProject = randomUUID(),
      unrelatedProject = randomUUID(),
      issue = randomUUID();
    await db.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Alice','alice@example.test'),($2,'Bob','bob@example.test')",
      [alice, bob],
    );
    await db.pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'First'),($2,'Other')",
      [org, other],
    );
    await db.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'member')",
      [org, alice, other, bob],
    );
    await db.pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'Backend','ENG')",
      [team, org],
    );
    await db.pool.query(
      "INSERT INTO team_workflow(organisation_id,team_id) VALUES($1,$2)",
      [org, team],
    );
    await db.pool.query(
      "INSERT INTO workflow_status(id,organisation_id,team_id,name,category,position,is_default) VALUES($1,$2,$3,'Backlog','backlog',0,true)",
      [status, org, team],
    );
    await db.pool.query(
      "INSERT INTO project(id,organisation_id,name) VALUES($1,$2,'Linked'),($3,$4,'Foreign'),($5,$2,'Unrelated')",
      [project, org, foreignProject, other, unrelatedProject],
    );
    await db.pool.query(
      "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
      [org, project, team],
    );
    await db.pool.query(
      "INSERT INTO issue(id,organisation_id,team_id,number,title,status_id) VALUES($1,$2,$3,1,'Existing',$4)",
      [issue, org, team, status],
    );
    expect(
      (
        await db.pool.query(
          "SELECT assignee_id,project_id FROM issue WHERE id=$1",
          [issue],
        )
      ).rows,
    ).toEqual([{ assignee_id: null, project_id: null }]);
    await expect(
      db.pool.query("UPDATE issue SET assignee_id=$1 WHERE id=$2", [
        bob,
        issue,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    await db.pool.query(
      "UPDATE issue SET assignee_id=$1,project_id=$2 WHERE id=$3",
      [alice, project, issue],
    );
    await expect(
      db.pool.query(
        "DELETE FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
        [org, alice],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query(
        "DELETE FROM project_team WHERE organisation_id=$1 AND project_id=$2",
        [org, project],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    for (const projectId of [foreignProject, unrelatedProject])
      await expect(
        db.pool.query("UPDATE issue SET project_id=$1 WHERE id=$2", [
          projectId,
          issue,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
    await db.pool.query(
      "INSERT INTO issue_activity(organisation_id,issue_id,issue_version,actor_id,actor_name,kind,cause,changes) VALUES($1,$2,2,$3,'Alice','assignment_cleared','organisation_member_removed','{}')",
      [org, issue, alice],
    );
    await db.pool.query(
      "UPDATE issue SET assignee_id=null,project_id=null WHERE id=$1",
      [issue],
    );
    await db.pool.query(
      "DELETE FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
      [org, alice],
    );
    await db.pool.query(
      "DELETE FROM project_team WHERE organisation_id=$1 AND project_id=$2",
      [org, project],
    );
    expect(
      (await db.pool.query("SELECT id FROM issue WHERE id=$1", [issue]))
        .rowCount,
    ).toBe(1);
  } finally {
    await db.close();
  }
});
