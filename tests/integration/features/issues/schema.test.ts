import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";

it("enforces issue scope, numbering, data bounds and history integrity without tying authors to membership", async () => {
  const db = await createTestDatabase({ migrate: true });
  try {
    const org = randomUUID(),
      otherOrg = randomUUID(),
      team = randomUUID(),
      otherTeam = randomUUID(),
      status = randomUUID(),
      foreignStatus = randomUUID(),
      user = randomUUID(),
      issue = randomUUID();
    await db.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Author','author@example.test')",
      [user],
    );
    await db.pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'First'),($2,'Other')",
      [org, otherOrg],
    );
    await db.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner')",
      [org, user],
    );
    await db.pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'Backend','ENG'),($3,$4,'Other','OTHER')",
      [team, org, otherTeam, otherOrg],
    );
    await db.pool.query(
      "INSERT INTO team_workflow(organisation_id,team_id) VALUES($1,$2),($3,$4)",
      [org, team, otherOrg, otherTeam],
    );
    await db.pool.query(
      "INSERT INTO workflow_status(id,organisation_id,team_id,name,category,position,is_default) VALUES($1,$2,$3,'Backlog','backlog',0,true),($4,$5,$6,'Backlog','backlog',0,true)",
      [status, org, team, foreignStatus, otherOrg, otherTeam],
    );
    await db.pool.query(
      "INSERT INTO issue(id,organisation_id,team_id,number,title,status_id,creator_id,created_at) VALUES($1,$2,$3,1,'First',$4,$5,'2026-11-06T12:34:56.123456Z')",
      [issue, org, team, status, user],
    );
    const [row] = (
      await db.pool.query<{ precision: number; due_date: unknown }>(
        "SELECT extract(microseconds FROM created_at)::int % 1000 AS precision,due_date FROM issue WHERE id=$1",
        [issue],
      )
    ).rows;
    expect(row).toEqual({ precision: 0, due_date: null });
    await expect(
      db.pool.query(
        "INSERT INTO issue(organisation_id,team_id,number,title,status_id) VALUES($1,$2,1,'Duplicate',$3)",
        [org, team, status],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.pool.query("UPDATE issue SET status_id=$1 WHERE id=$2", [
        foreignStatus,
        issue,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
    for (const set of [
      "title=' '",
      "title=repeat('x',201)",
      "description=repeat('x',20001)",
      "number=0",
      "version=0",
      "due_date='infinity'",
      "due_date='10000-01-01'",
    ])
      await expect(
        db.pool.query(`UPDATE issue SET ${set} WHERE id=$1`, [issue]),
      ).rejects.toMatchObject({ code: "23514" });
    await db.pool.query(
      "INSERT INTO issue_counter(organisation_id,team_id,last_number) VALUES($1,$2,1)",
      [org, team],
    );
    await expect(
      db.pool.query("UPDATE issue_counter SET last_number=-1"),
    ).rejects.toMatchObject({ code: "23514" });
    await db.pool.query(
      "INSERT INTO issue_activity(organisation_id,issue_id,issue_version,actor_id,actor_name,kind,cause,changes) VALUES($1,$2,1,$3,'Historical Author','created','user','{}')",
      [org, issue, user],
    );
    await expect(
      db.pool.query(
        "INSERT INTO issue_activity(organisation_id,issue_id,issue_version,actor_name,kind,cause,changes) VALUES($1,$2,1,'Author','created','user','{}')",
        [org, issue],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.pool.query("UPDATE issue_activity SET organisation_id=$1", [otherOrg]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query("UPDATE issue_activity SET changes='[]'"),
    ).rejects.toMatchObject({ code: "23514" });
    await db.pool.query(
      "DELETE FROM organisation_member WHERE organisation_id=$1",
      [org],
    );
    expect((await db.pool.query("SELECT 1 FROM issue")).rowCount).toBe(1);
    await db.pool.query("DELETE FROM auth_user WHERE id=$1", [user]);
    expect((await db.pool.query("SELECT creator_id FROM issue")).rows).toEqual([
      { creator_id: null },
    ]);
    expect(
      (await db.pool.query("SELECT actor_id,actor_name FROM issue_activity"))
        .rows,
    ).toEqual([{ actor_id: null, actor_name: "Historical Author" }]);
    await db.pool.query("DELETE FROM organisation WHERE id=$1", [org]);
    for (const table of ["issue", "issue_activity", "issue_counter"])
      expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
  } finally {
    await db.close();
  }
});
