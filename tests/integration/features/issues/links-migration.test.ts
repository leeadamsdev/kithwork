import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@kithwork/database/migrate";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../platform/database/fixtures.js";
import { createTemporaryDirectory } from "../../../temporary-directory.js";

it("preserves existing issues, versions and history while adding nullable links on repeated upgrade", async () => {
  const db = await createTestDatabase(),
    previous = await createTemporaryDirectory("issue-links-upgrade-");
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
    journal.entries = journal.entries.slice(0, 7);
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
      status = randomUUID(),
      user = randomUUID(),
      issue = randomUUID();
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
      "INSERT INTO issue(id,organisation_id,team_id,number,title,status_id,creator_id) VALUES($1,$2,$3,1,'Preserved',$4,$5)",
      [issue, org, team, status, user],
    );
    await db.pool.query(
      "INSERT INTO issue_activity(organisation_id,issue_id,issue_version,actor_id,actor_name,kind,cause,changes) VALUES($1,$2,1,$3,'Existing','created','user','{}')",
      [org, issue, user],
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
                `SELECT jsonb_agg(${table === "issue" ? "to_jsonb(t)-'assignee_id'-'project_id'" : "to_jsonb(t)"} ORDER BY to_jsonb(t)::text) AS value FROM "${table}" t`,
              )
            ).rows[0]!.value,
        ),
      );
    const before = await snapshot();
    await migrate(source);
    await migrate(source);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.pool.query(
          "SELECT assignee_id,project_id FROM issue WHERE id=$1",
          [issue],
        )
      ).rows,
    ).toEqual([{ assignee_id: null, project_id: null }]);
  } finally {
    await db.close();
    await rm(previous, { recursive: true, force: true });
  }
});
