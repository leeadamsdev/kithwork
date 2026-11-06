import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@kithwork/database/migrate";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";
import { createTemporaryDirectory } from "../../../temporary-directory.js";

it("adds projects without changing accounts, organisation access, delivery or team memberships", async () => {
  const database = await createTestDatabase();
  const previous = await createTemporaryDirectory("projects-upgrade-");
  const source = fileURLToPath(
    new URL("../../../../packages/database/migrations/", import.meta.url),
  );
  const migrate = (migrationsFolder: string) =>
    migrateDatabase({
      connectionString: database.connectionString,
      migrationsFolder,
      onPoolError: database.onPoolError,
    });
  try {
    await mkdir(join(previous, "meta"));
    for (const file of [
      "0000_authentication.sql",
      "0001_organisation_access.sql",
      "0002_invitation_outbox.sql",
      "0003_teams.sql",
    ])
      await cp(join(source, file), join(previous, file));
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 4);
    await writeFile(
      join(previous, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    await migrate(previous);
    const userId = randomUUID(),
      organisationId = randomUUID(),
      invitationId = randomUUID();
    await database.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Existing owner','owner@example.test')",
      [userId],
    );
    await database.pool.query(
      "INSERT INTO auth_session(user_id,token,expires_at) VALUES($1,'retained-session',now()+interval '1 day')",
      [userId],
    );
    await database.pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'Existing organisation')",
      [organisationId],
    );
    await database.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner')",
      [organisationId, userId],
    );
    await database.pool.query(
      "INSERT INTO organisation_invitation(id,organisation_id,issuer_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,'invited@example.test','member',repeat('a',64),now()+interval '1 day')",
      [invitationId, organisationId, userId],
    );
    await database.pool.query(
      "INSERT INTO email_outbox(invitation_id,invitation_version,payload,expires_at) VALUES($1,1,'{}',now()+interval '1 day')",
      [invitationId],
    );
    const teamId = randomUUID();
    await database.pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES($1,$2,'Existing team','ENG')",
      [teamId, organisationId],
    );
    await database.pool.query(
      "INSERT INTO team_member(organisation_id,team_id,user_id,role) VALUES($1,$2,$3,'maintainer')",
      [organisationId, teamId, userId],
    );
    const tables = [
      "team",
      "team_member",
      "auth_user",
      "auth_session",
      "organisation",
      "organisation_member",
      "organisation_invitation",
      "email_outbox",
    ];
    const snapshot = async (table: string) =>
      (
        await database.pool.query<{ value: unknown }>(
          `SELECT jsonb_agg(to_jsonb(t)) AS value FROM ${table} t`,
        )
      ).rows[0]!.value;
    const before = await Promise.all(tables.map(snapshot));
    await migrate(source);
    await migrate(source);
    expect(await Promise.all(tables.map(snapshot))).toEqual(before);
    expect((await database.pool.query("SELECT id FROM project")).rowCount).toBe(
      0,
    );
    expect(
      (await database.pool.query("SELECT team_id FROM project_team")).rowCount,
    ).toBe(0);
  } finally {
    await database.close();
    await rm(previous, { recursive: true, force: true });
  }
});
