import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@kithwork/database/migrate";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../../platform/database/fixtures.js";
import { createTemporaryDirectory } from "../../../../temporary-directory.js";

it("preserves existing issues and history on repeat comment-schema upgrade", async () => {
  const db = await createTestDatabase(),
    previous = await createTemporaryDirectory("comments-upgrade-");
  const source = fileURLToPath(
    new URL("../../../../../packages/database/migrations/", import.meta.url),
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
    journal.entries = journal.entries.slice(0, 8);
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
    await db.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES('00000000-0000-4000-8000-000000000001','Existing','existing@example.test')",
    );
    await db.pool.query(
      "INSERT INTO organisation(id,name) VALUES('00000000-0000-4000-8000-000000000002','Existing')",
    );
    await db.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','owner')",
    );
    await db.pool.query(
      "INSERT INTO team(id,organisation_id,name,key) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','Existing','ENG')",
    );
    await db.pool.query(
      "INSERT INTO team_workflow(organisation_id,team_id) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003')",
    );
    await db.pool.query(
      "INSERT INTO workflow_status(id,organisation_id,team_id,name,category,position,is_default) VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','Backlog','backlog',0,true)",
    );
    await db.pool.query(
      "INSERT INTO issue(id,organisation_id,team_id,number,title,status_id) VALUES('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',1,'Existing','00000000-0000-4000-8000-000000000004')",
    );
    await db.pool.query(
      "INSERT INTO issue_activity(organisation_id,issue_id,issue_version,actor_name,kind,cause,changes) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005',1,'Existing','created','user','{}')",
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
  } finally {
    await db.close();
    await rm(previous, { recursive: true, force: true });
  }
});
