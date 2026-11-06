import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@kithwork/database/migrate";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";
import { createTemporaryDirectory } from "../../../temporary-directory.js";

it("adds issue storage on repeated upgrade without altering existing teams, workflows or tenant data", async () => {
  const db = await createTestDatabase();
  const previous = await createTemporaryDirectory("issues-upgrade-");
  const source = fileURLToPath(
    new URL("../../../../packages/database/migrations/", import.meta.url),
  );
  const migrate = (folder: string) =>
    migrateDatabase({
      connectionString: db.connectionString,
      migrationsFolder: folder,
      onPoolError: db.onPoolError,
    });
  try {
    await mkdir(join(previous, "meta"));
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    journal.entries = journal.entries.slice(0, 6);
    for (const entry of journal.entries)
      await cp(
        join(source, entry.tag + ".sql"),
        join(previous, entry.tag + ".sql"),
      );
    await writeFile(
      join(previous, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    await migrate(previous);
    const org = randomUUID(),
      team = randomUUID(),
      user = randomUUID();
    await db.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Existing','existing@example.test')",
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
      "INSERT INTO team(id,organisation_id,name,key,archived_at) VALUES($1,$2,'Archived','OLD',now())",
      [team, org],
    );
    await db.pool.query(
      "INSERT INTO team_workflow(organisation_id,team_id) VALUES($1,$2)",
      [org, team],
    );
    await db.pool.query(
      "INSERT INTO workflow_status(organisation_id,team_id,name,category,position,is_default) VALUES($1,$2,'Backlog','backlog',0,true)",
      [org, team],
    );
    const tables = (
      await db.pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    const snapshot = () =>
      Promise.all(
        tables.map(
          async (table) =>
            (
              await db.pool.query<{ value: unknown }>(
                `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS value FROM "${table}" t`,
              )
            ).rows[0]!.value,
        ),
      );
    const before = await snapshot();
    await migrate(source);
    await migrate(source);
    expect(await snapshot()).toEqual(before);
    for (const table of ["issue", "issue_counter", "issue_activity"])
      expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
  } finally {
    await db.close();
    await rm(previous, { recursive: true, force: true });
  }
});
