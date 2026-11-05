import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { migrateDatabase } from "@kithwork/database/migrate";
import { createTestDatabase } from "../../platform/database/fixtures.js";
import { createTemporaryDirectory } from "../../../temporary-directory.js";

it("upgrades existing organisations, memberships and sessions without changing them", async () => {
  const database = await createTestDatabase();
  const previous = await createTemporaryDirectory("invitation-upgrade-");
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
    ])
      await cp(join(source, file), join(previous, file));
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 2);
    await writeFile(
      join(previous, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    await migrate(previous);
    const userId = randomUUID(),
      orgId = randomUUID();
    await database.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Existing owner','existing@example.test')",
      [userId],
    );
    await database.pool.query(
      "INSERT INTO auth_session(user_id,token,expires_at) VALUES($1,'preserved-session',now()+interval '1 day')",
      [userId],
    );
    await database.pool.query(
      "INSERT INTO organisation(id,name) VALUES($1,'Existing team')",
      [orgId],
    );
    await database.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner')",
      [orgId, userId],
    );
    await migrate(source);
    await migrate(source);
    expect(
      (
        await database.pool.query("SELECT name FROM organisation WHERE id=$1", [
          orgId,
        ])
      ).rows,
    ).toEqual([{ name: "Existing team" }]);
    expect(
      (
        await database.pool.query(
          "SELECT user_id,role FROM organisation_member WHERE organisation_id=$1",
          [orgId],
        )
      ).rows,
    ).toEqual([{ user_id: userId, role: "owner" }]);
    expect(
      (
        await database.pool.query(
          "SELECT token FROM auth_session WHERE user_id=$1",
          [userId],
        )
      ).rows,
    ).toEqual([{ token: "preserved-session" }]);
    expect(
      (await database.pool.query("SELECT id FROM email_outbox")).rowCount,
    ).toBe(0);
  } finally {
    await database.close();
    await rm(previous, { recursive: true, force: true });
  }
});
