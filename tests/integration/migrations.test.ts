import { migrateDatabase } from "@kithwork/database/migrate";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestDatabase, databaseFixture } from "./fixtures.js";

describe("PostgreSQL migrations", () => {
  const fixture = databaseFixture();

  it("applies a migration once and preserves existing data on subsequent runs", async () => {
    const { connectionString, onPoolError, pool } = fixture();
    const options = {
      connectionString,
      onPoolError,
      migrationsFolder: fileURLToPath(
        new URL("./fixtures/migrations/valid/", import.meta.url),
      ),
    };
    await migrateDatabase(options);
    await pool.query("INSERT INTO migration_probe (value) VALUES ($1)", [
      "preserved",
    ]);
    await migrateDatabase(options);
    expect(
      (await pool.query("SELECT value FROM migration_probe")).rows,
    ).toEqual([{ value: "preserved" }]);
    expect(
      (
        await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
        )
      ).rows,
    ).toEqual([{ count: "1" }]);
  });

  it("rolls back failed SQL without recording the migration", async () => {
    const isolated = await createTestDatabase();
    const { connectionString, onPoolError, pool } = isolated;
    try {
      await expect(
        migrateDatabase({
          connectionString,
          onPoolError,
          migrationsFolder: fileURLToPath(
            new URL("./fixtures/migrations/invalid/", import.meta.url),
          ),
        }),
      ).rejects.toThrow();
      expect(
        (
          await pool.query(
            "SELECT to_regclass('public.failed_migration_probe')::text AS table_name",
          )
        ).rows,
      ).toEqual([{ table_name: null }]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
          )
        ).rows,
      ).toEqual([{ count: "0" }]);
    } finally {
      await isolated.close();
    }
  });

  it("reports a missing migration directory", async () => {
    const { connectionString, onPoolError } = fixture();
    await expect(
      migrateDatabase({
        connectionString,
        onPoolError,
        migrationsFolder: fileURLToPath(
          new URL("./fixtures/migrations/missing/", import.meta.url),
        ),
      }),
    ).rejects.toThrow("Can't find meta/_journal.json");
  });
});
