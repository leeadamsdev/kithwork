import { createTemporaryDirectory } from "../../../temporary-directory.js";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@kithwork/database/migrate";
import { databaseFixture } from "../../platform/database/fixtures.js";

const database = databaseFixture();
it("upgrades existing authentication data and enforces organisation membership constraints", async () => {
  const client = database();
  const source = fileURLToPath(
    new URL("../../../../packages/database/migrations/", import.meta.url),
  );
  const previous = await createTemporaryDirectory("kithwork-org-upgrade-");
  const migrate = (migrationsFolder: string) =>
    migrateDatabase({
      connectionString: client.connectionString,
      migrationsFolder,
      onPoolError: client.onPoolError,
    });
  try {
    await mkdir(join(previous, "meta"));
    await cp(
      join(source, "0000_authentication.sql"),
      join(previous, "0000_authentication.sql"),
    );
    const journal = JSON.parse(
      await readFile(join(source, "meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    await writeFile(
      join(previous, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    await migrate(previous);
    const userId = randomUUID();
    await client.pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Existing user','existing@example.test')",
      [userId],
    );
    await client.pool.query(
      "INSERT INTO auth_session(user_id,token,expires_at) VALUES($1,'preserved-session',now()+interval '1 day')",
      [userId],
    );
    await migrate(source);
    await migrate(source);
    expect(
      (
        await client.pool.query("SELECT name FROM auth_user WHERE id=$1", [
          userId,
        ])
      ).rows,
    ).toEqual([{ name: "Existing user" }]);
    expect(
      (
        await client.pool.query(
          "SELECT token FROM auth_session WHERE user_id=$1",
          [userId],
        )
      ).rows,
    ).toEqual([{ token: "preserved-session" }]);
    const org = await client.pool.query<{ id: string }>(
      "INSERT INTO organisation(name) VALUES('Engineering') RETURNING id",
    );
    const id = org.rows[0]!.id;
    await client.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'owner')",
      [id, userId],
    );
    await expect(
      client.pool.query(
        "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'member')",
        [id, userId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      client.pool.query(
        "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'superadmin')",
        [id, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      client.pool.query(
        "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'member')",
        [randomUUID(), userId],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      client.pool.query(
        "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,'member')",
        [id, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      client.pool.query("DELETE FROM auth_user WHERE id=$1", [userId]),
    ).rejects.toMatchObject({ code: "23001" });
    await client.pool.query("DELETE FROM organisation WHERE id=$1", [id]);
    expect(
      (await client.pool.query("SELECT * FROM organisation_member")).rows,
    ).toEqual([]);
    expect(
      (
        await client.pool.query("SELECT id FROM auth_user WHERE id=$1", [
          userId,
        ])
      ).rows,
    ).toHaveLength(1);
  } finally {
    await rm(previous, { recursive: true, force: true });
  }
});
