import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";

it("enforces tenant-safe team relationships, scoped keys and membership cascades", async () => {
  const database = await createTestDatabase({ migrate: true });
  const { pool } = database;
  try {
    expect(
      (
        await pool.query<{ table: string | null }>(
          "SELECT to_regclass('team')::text AS table",
        )
      ).rows[0]?.table,
    ).toBe("team");
    const userId = randomUUID(),
      first = randomUUID(),
      second = randomUUID(),
      teamId = randomUUID();
    await pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Member','member@example.test')",
      [userId],
    );
    await pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'First'),($2,'Second')",
      [first, second],
    );
    await pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'member')",
      [first, userId],
    );
    await pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'Backend','ENG')",
      [teamId, first],
    );
    await pool.query(
      "INSERT INTO team(organisation_id,name,key) VALUES($1,'Other Backend','ENG')",
      [second],
    );
    await expect(
      pool.query(
        "INSERT INTO team(organisation_id,name,key) VALUES($1,'Duplicate','ENG')",
        [first],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await pool.query("UPDATE team SET archived_at=now() WHERE id=$1", [teamId]);
    await expect(
      pool.query(
        "INSERT INTO team(organisation_id,name,key) VALUES($1,'Reused','ENG')",
        [first],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    for (const set of [
      "key='eng'",
      "name=' '",
      "description=repeat('x',2001)",
      "version=0",
    ])
      await expect(
        pool.query(`UPDATE team SET ${set} WHERE id=$1`, [teamId]),
      ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "INSERT INTO team_member(organisation_id,team_id,user_id,role) VALUES($1,$2,$3,'member')",
        [second, teamId, userId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      pool.query(
        "INSERT INTO team_member(organisation_id,team_id,user_id,role) VALUES($1,$2,$3,'member')",
        [first, teamId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await pool.query(
      "INSERT INTO team_member(organisation_id,team_id,user_id,role) VALUES($1,$2,$3,'maintainer')",
      [first, teamId, userId],
    );
    await expect(
      pool.query("UPDATE team_member SET role='admin' WHERE team_id=$1", [
        teamId,
      ]),
    ).rejects.toMatchObject({ code: "22P02" });
    await pool.query(
      "DELETE FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
      [first, userId],
    );
    expect((await pool.query("SELECT user_id FROM team_member")).rowCount).toBe(
      0,
    );
    expect(
      (await pool.query("SELECT id FROM team WHERE id=$1", [teamId])).rowCount,
    ).toBe(1);
    await pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'member')",
      [first, userId],
    );
    expect((await pool.query("SELECT user_id FROM team_member")).rowCount).toBe(
      0,
    );
  } finally {
    await database.close();
  }
});
