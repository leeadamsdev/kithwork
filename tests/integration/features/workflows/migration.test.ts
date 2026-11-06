import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@kithwork/database/migrate";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";
import { createTemporaryDirectory } from "../../../temporary-directory.js";

it("backfills workflows for active and archived teams while preserving existing tenant data on repeated upgrade", async () => {
  const db = await createTestDatabase();
  const previous = await createTemporaryDirectory("workflows-upgrade-");
  const source = fileURLToPath(
    new URL("../../../../packages/database/migrations/", import.meta.url),
  );
  const migrate = (migrationsFolder: string) =>
    migrateDatabase({
      connectionString: db.connectionString,
      migrationsFolder,
      onPoolError: db.onPoolError,
    });
  try {
    await mkdir(join(previous, "meta"));
    for (const file of [
      "0000_authentication.sql",
      "0001_organisation_access.sql",
      "0002_invitation_outbox.sql",
      "0003_teams.sql",
      "0004_projects.sql",
    ])
      await cp(join(source, file), join(previous, file));
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 5);
    await writeFile(
      join(previous, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    await migrate(previous);
    const user = randomUUID(),
      org = randomUUID(),
      team = randomUUID(),
      archived = randomUUID(),
      project = randomUUID(),
      invitation = randomUUID();
    await db.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Existing owner','owner@example.test')",
      [user],
    );
    await db.pool.query(
      "INSERT INTO auth_session(user_id,token,expires_at) VALUES($1,'retained-session',now()+interval '1 day')",
      [user],
    );
    await db.pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'Existing')",
      [org],
    );
    await db.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner')",
      [org, user],
    );
    await db.pool.query(
      "INSERT INTO organisation_invitation(id,organisation_id,issuer_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,'invited@example.test','member',repeat('a',64),now()+interval '1 day')",
      [invitation, org, user],
    );
    await db.pool.query(
      "INSERT INTO email_outbox(invitation_id,invitation_version,payload,expires_at) VALUES($1,1,'{}',now()+interval '1 day')",
      [invitation],
    );
    await db.pool.query(
      "INSERT INTO team(id,organisation_id,name,key,archived_at) VALUES($1,$2,'Active','ENG',null),($3,$2,'Archived','OLD',now())",
      [team, org, archived],
    );
    await db.pool.query(
      "INSERT INTO team_member(organisation_id,team_id,user_id,role) VALUES($1,$2,$3,'maintainer')",
      [org, team, user],
    );
    await db.pool.query(
      "INSERT INTO project(id,organisation_id,name) VALUES($1,$2,'Launch')",
      [project, org],
    );
    await db.pool.query(
      "INSERT INTO project_team(organisation_id,project_id,team_id) VALUES($1,$2,$3)",
      [org, project, team],
    );
    const tables = [
      "auth_user",
      "auth_session",
      "organisation",
      "organisation_member",
      "organisation_invitation",
      "email_outbox",
      "team",
      "team_member",
      "project",
      "project_team",
    ];
    const snapshot = async (table: string) =>
      (
        await db.pool.query<{ value: unknown }>(
          `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS value FROM ${table} t`,
        )
      ).rows[0]!.value;
    const before = await Promise.all(tables.map(snapshot));
    await migrate(source);
    const initialIds = (
      await db.pool.query("SELECT id FROM workflow_status ORDER BY id")
    ).rows;
    await migrate(source);
    expect(await Promise.all(tables.map(snapshot))).toEqual(before);
    expect(
      (await db.pool.query("SELECT id FROM workflow_status ORDER BY id")).rows,
    ).toEqual(initialIds);
    expect(
      (await db.pool.query("SELECT version FROM team_workflow")).rows,
    ).toEqual([{ version: 1 }, { version: 1 }]);
    for (const teamId of [team, archived]) {
      expect(
        (
          await db.pool.query(
            "SELECT name,category,position,is_default FROM workflow_status WHERE team_id=$1 ORDER BY category",
            [teamId],
          )
        ).rows,
      ).toEqual([
        { name: "Backlog", category: "backlog", position: 0, is_default: true },
        { name: "Todo", category: "unstarted", position: 0, is_default: false },
        {
          name: "In Progress",
          category: "started",
          position: 0,
          is_default: false,
        },
        { name: "Done", category: "completed", position: 0, is_default: false },
        {
          name: "Cancelled",
          category: "cancelled",
          position: 0,
          is_default: false,
        },
      ]);
    }
  } finally {
    await db.close();
    await rm(previous, { recursive: true, force: true });
  }
});
