import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";

it("enforces project date, tenant and relationship integrity including cascading associations", async () => {
  const db = await createTestDatabase({ migrate: true });
  try {
    const { pool } = db;
    const first = randomUUID(),
      second = randomUUID(),
      team = randomUUID(),
      project = randomUUID();
    await pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'First'),($2,'Second')",
      [first, second],
    );
    await pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'Backend','ENG')",
      [team, first],
    );
    await pool.query(
      "INSERT INTO project(id,organisation_id,name,start_date,target_date) VALUES($1,$2,'Launch','2028-02-29','2028-03-01')",
      [project, first],
    );
    for (const set of [
      "start_date='2028-03-02'",
      "name=' '",
      "description=repeat('x',2001)",
      "version=0",
    ])
      await expect(
        pool.query(`UPDATE project SET ${set} WHERE id=$1`, [project]),
      ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query("UPDATE project SET status='unknown' WHERE id=$1", [project]),
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      pool.query(
        "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
        [second, project, team],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const foreignProject = randomUUID();
    await pool.query(
      "INSERT INTO project(id,organisation_id,name) VALUES($1,$2,'Other')",
      [foreignProject, second],
    );
    await expect(
      pool.query(
        "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
        [second, foreignProject, team],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool.query(
        "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
        [first, foreignProject, team],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await pool.query(
      "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
      [first, project, team],
    );
    await expect(
      pool.query(
        "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
        [first, project, team],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await pool.query("DELETE FROM team WHERE id=$1", [team]);
    expect((await pool.query("SELECT * FROM project_team")).rowCount).toBe(0);
    const replacement = randomUUID();
    await pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'New','WEB')",
      [replacement, first],
    );
    await pool.query(
      "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
      [first, project, replacement],
    );
    await pool.query("DELETE FROM project WHERE id=$1", [project]);
    expect((await pool.query("SELECT * FROM project_team")).rowCount).toBe(0);
    expect(
      (await pool.query("SELECT id FROM team WHERE id=$1", [replacement]))
        .rowCount,
    ).toBe(1);
  } finally {
    await db.close();
  }
});
