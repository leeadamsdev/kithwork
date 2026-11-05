import { createDatabase } from "@kithwork/database";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createTestDatabase, databaseFixture } from "./fixtures.js";

describe("PostgreSQL database client", () => {
  const fixture = databaseFixture();
  it("enforces the worker's server-side statement deadline without changing other clients", async () => {
    const limited = createDatabase({
      connectionString: fixture().connectionString,
      statementTimeoutMs: 50,
      onPoolError: () => {},
    });
    try {
      await expect(
        limited.pool.query("SELECT pg_sleep(0.2)"),
      ).rejects.toMatchObject({ code: "57014" });
    } finally {
      await limited.pool.end();
    }
    expect((await fixture().pool.query("SELECT 1 AS value")).rows).toEqual([
      { value: 1 },
    ]);
  });

  it("executes Drizzle queries and parameterized pg queries", async () => {
    const { db, pool } = fixture();
    const result = await db.execute("SELECT 1 AS value");
    expect(result.rows).toEqual([{ value: 1 }]);
    const parameter = "Robert'); DROP TABLE users;--";
    const parameterized = await pool.query<{ value: string }>(
      "SELECT $1::text AS value",
      [parameter],
    );
    expect(parameterized.rows).toEqual([{ value: parameter }]);
  });

  it("commits successful transactions and rolls back rejected transactions", async () => {
    const { db, pool } = fixture();
    await pool.query("CREATE TABLE transaction_probe (value text NOT NULL)");
    await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO transaction_probe VALUES ('committed')");
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          "INSERT INTO transaction_probe VALUES ('rolled back')",
        );
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");
    expect(
      (
        await pool.query<{ value: string }>(
          "SELECT value FROM transaction_probe",
        )
      ).rows,
    ).toEqual([{ value: "committed" }]);
  });

  it("isolates data in separately provisioned test databases", async () => {
    const second = await createTestDatabase();
    try {
      await fixture().pool.query("CREATE TABLE isolation_probe (value text)");
      const result = await second.pool.query<{ table_name: string | null }>(
        "SELECT to_regclass('public.isolation_probe')::text AS table_name",
      );
      expect(result.rows).toEqual([{ table_name: null }]);
    } finally {
      await second.close();
    }
  });

  it("reports idle connection failures to the caller and can reconnect", async () => {
    const { connectionString, pool } = fixture();
    const reported = Promise.withResolvers<Error>();
    const client = createDatabase({
      connectionString,
      maxConnections: 1,
      onPoolError: reported.resolve,
    });
    try {
      const connection = await client.pool.connect();
      const pid = (
        await connection.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        )
      ).rows[0]?.pid;
      connection.release();
      await pool.query("SELECT pg_terminate_backend($1)", [pid]);
      expect(await reported.promise).toBeInstanceOf(Error);
      expect((await client.pool.query("SELECT 1 AS value")).rows).toEqual([
        { value: 1 },
      ]);
    } finally {
      await client.pool.end();
    }
  });

  it("closes connections when the owner ends the pool", async () => {
    const { connectionString, onPoolError } = fixture();
    const { pool } = createDatabase({ connectionString, onPoolError });
    const connection = await pool.connect();
    const removed = once(pool, "remove");
    connection.release();
    await pool.end();
    await removed;
    expect(pool.totalCount).toBe(0);
    await expect(pool.query("SELECT 1")).rejects.toThrow(
      "Cannot use a pool after calling end",
    );
  });
});
