import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrateDatabase } from "@kithwork/database/migrate";
import { databaseFixture } from "./fixtures.js";

const database = databaseFixture();

it("applies the real authentication schema with unique identities and cascading ownership", async () => {
  const client = database();
  await migrateDatabase({
    connectionString: client.connectionString,
    migrationsFolder: fileURLToPath(
      new URL("../../packages/database/migrations/", import.meta.url),
    ),
    onPoolError: client.onPoolError,
  });
  const tables = await client.pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND left(table_name, 5) = 'auth_' ORDER BY table_name",
  );
  expect(tables.rows.map((row) => row.table_name)).toEqual([
    "auth_account",
    "auth_session",
    "auth_user",
    "auth_verification",
  ]);
  const userId = randomUUID();
  const sessionId = randomUUID();
  await client.pool.query(
    "INSERT INTO auth_user (id, name, email) VALUES ($1, $2, $3)",
    [userId, "Lee", "lee@example.test"],
  );
  await expect(
    client.pool.query(
      "INSERT INTO auth_user (id, name, email) VALUES ($1, $2, $3)",
      [randomUUID(), "Duplicate", "lee@example.test"],
    ),
  ).rejects.toMatchObject({ code: "23505" });
  await client.pool.query(
    "INSERT INTO auth_session (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')",
    [sessionId, userId, "test-session-token"],
  );
  await client.pool.query(
    "INSERT INTO auth_account (id, user_id, account_id, provider_id) VALUES ($1, $2, $3, $4)",
    [randomUUID(), userId, userId, "credential"],
  );
  await expect(
    client.pool.query(
      "INSERT INTO auth_account (id, user_id, account_id, provider_id) VALUES ($1, $2, $3, $4)",
      [randomUUID(), userId, userId, "credential"],
    ),
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    client.pool.query(
      "INSERT INTO auth_session (id, user_id, token, expires_at) VALUES ($1, $2, $3, now())",
      [randomUUID(), randomUUID(), "missing-user"],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  await client.pool.query("DELETE FROM auth_user WHERE id = $1", [userId]);
  expect((await client.pool.query("SELECT id FROM auth_session")).rows).toEqual(
    [],
  );
  expect((await client.pool.query("SELECT id FROM auth_account")).rows).toEqual(
    [],
  );
});
