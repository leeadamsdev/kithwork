import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "@kithwork/database/migrate";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../../platform/database/fixtures.js";
import { createTemporaryDirectory } from "../../../../temporary-directory.js";
import { seedIssueParticipation } from "../participation-fixtures.js";

it("backfills eligible existing participants once without rewriting bodies, mention identities or explicit choices", async () => {
  const db = await createTestDatabase(),
    previous = await createTemporaryDirectory("participation-upgrade-");
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
    journal.entries = journal.entries.slice(0, 9);
    for (const e of journal.entries)
      await cp(join(source, e.tag + ".sql"), join(previous, e.tag + ".sql"));
    await writeFile(
      join(previous, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    await migrate(previous);
    const s = await seedIssueParticipation(db);
    await db.pool.query("UPDATE issue SET archived_at=now() WHERE id=$1", [
      s.issue,
    ]);
    await db.pool.query(
      "INSERT INTO issue_comment(organisation_id,issue_id,author_id,author_name,body,deleted_at,creation_key,creation_hash) VALUES($1,$2,$3,'Dave',null,now(),$4,$5)",
      [s.org, s.issue, s.dave, randomUUID(), "b".repeat(64)],
    );
    const privateTeam = randomUUID(),
      privateStatus = randomUUID();
    await db.pool.query(
      "INSERT INTO team(id,organisation_id,name,key,visibility) VALUES($1,$2,'Private','SEC','private')",
      [privateTeam, s.org],
    );
    await db.pool.query(
      "INSERT INTO team_workflow(organisation_id,team_id) VALUES($1,$2)",
      [s.org, privateTeam],
    );
    await db.pool.query(
      "INSERT INTO workflow_status(id,organisation_id,team_id,name,category,position,is_default) VALUES($1,$2,$3,'Backlog','backlog',0,true)",
      [privateStatus, s.org, privateTeam],
    );
    await db.pool.query(
      "INSERT INTO issue(organisation_id,team_id,number,title,status_id,creator_id) VALUES($1,$2,1,'Private old creator',$3,$4)",
      [s.org, privateTeam, privateStatus, s.carol],
    );
    const tables = (
      await db.pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    const snapshot = () =>
      Promise.all(
        tables.map(
          async (table) =>
            (
              await db.pool.query<{ value: unknown }>(
                `SELECT jsonb_agg(to_jsonb(t)-'mentions_initialised' ORDER BY to_jsonb(t)::text) AS value FROM "${table}" t`,
              )
            ).rows[0]!.value,
        ),
      );
    const before = await snapshot();
    await migrate(source);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.pool.query(
          "SELECT user_id,state FROM issue_subscription WHERE issue_id=$1 ORDER BY user_id",
          [s.issue],
        )
      ).rows,
    ).toEqual(
      [s.alice, s.bob, s.carol]
        .sort()
        .map((user_id) => ({ user_id, state: "watching" })),
    );
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM issue_subscription",
        )
      ).rows,
    ).toEqual([{ count: 3 }]);
    expect(
      (
        await db.pool.query<{ mentions_initialised: boolean }>(
          "SELECT mentions_initialised FROM issue_comment",
        )
      ).rows.every((r) => r.mentions_initialised === false),
    ).toBe(true);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM issue_comment_mention",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    await db.pool.query(
      "UPDATE issue_subscription SET state='muted' WHERE user_id=$1",
      [s.bob],
    );
    await db.pool.query("DELETE FROM issue_subscription WHERE user_id=$1", [
      s.carol,
    ]);
    await migrate(source);
    expect(
      (
        await db.pool.query(
          "SELECT user_id,state FROM issue_subscription ORDER BY user_id",
        )
      ).rows,
    ).toEqual(
      [
        { user_id: s.alice, state: "watching" },
        { user_id: s.bob, state: "muted" },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    );
    expect(await snapshot()).toEqual(before);
  } finally {
    await db.close();
    await rm(previous, { recursive: true, force: true });
  }
});
