import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";

it("enforces tenant-safe workflow relationships, status names and default constraints", async () => {
  const db = await createTestDatabase({ migrate: true });
  try {
    const org = randomUUID(),
      other = randomUUID(),
      team = randomUUID(),
      status = randomUUID();
    await db.pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'First'),($2,'Other')",
      [org, other],
    );
    await db.pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'Backend','ENG')",
      [team, org],
    );
    await db.pool.query(
      "INSERT INTO team_workflow(organisation_id,team_id) VALUES($1,$2)",
      [org, team],
    );
    await expect(
      db.pool.query(
        "INSERT INTO team_workflow(organisation_id,team_id) VALUES($1,$2)",
        [other, team],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await db.pool.query(
      "INSERT INTO workflow_status(id,organisation_id,team_id,name,category,position,is_default) VALUES($1,$2,$3,'Backlog','backlog',0,true)",
      [status, org, team],
    );
    await expect(
      db.pool.query(
        "INSERT INTO workflow_status(organisation_id,team_id,name,category,position) VALUES($1,$2,' backlog ','started',0)",
        [org, team],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.pool.query(
        "INSERT INTO workflow_status(organisation_id,team_id,name,category,position,is_default) VALUES($1,$2,'Todo','unstarted',0,true)",
        [org, team],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    for (const set of [
      "name=' '",
      "name=repeat('x',51)",
      "description=repeat('x',501)",
      "position=-1",
      "category='completed'",
      "retired_at=now()",
    ])
      await expect(
        db.pool.query(`UPDATE workflow_status SET ${set} WHERE id=$1`, [
          status,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.pool.query("UPDATE team_workflow SET version=0 WHERE team_id=$1", [
        team,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.pool.query(
        "INSERT INTO workflow_status(organisation_id,team_id,name,category,position) VALUES($1,$2,'Other','started',0)",
        [other, team],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await db.pool.query(
      "UPDATE workflow_status SET is_default=false,retired_at=now() WHERE id=$1",
      [status],
    );
    await expect(
      db.pool.query(
        "INSERT INTO workflow_status(organisation_id,team_id,name,category,position) VALUES($1,$2,'Backlog','backlog',1)",
        [org, team],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await db.pool.query("DELETE FROM team WHERE id=$1", [team]);
    expect((await db.pool.query("SELECT * FROM team_workflow")).rowCount).toBe(
      0,
    );
    expect(
      (await db.pool.query("SELECT * FROM workflow_status")).rowCount,
    ).toBe(0);
  } finally {
    await db.close();
  }
});
