import { createDatabase } from "@kithwork/database";
import { migrateDatabase } from "@kithwork/database/migrate";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll } from "vitest";
import { integrationServices } from "../../context.js";
import { uniqueNamespace } from "../../support/namespace.js";
export async function createTestDatabase({
  migrate = false,
}: { migrate?: boolean } = {}) {
  const name = uniqueNamespace();
  const { postgresUrl } = integrationServices();
  const errors: Error[] = [];
  const onPoolError = (error: Error) => {
    errors.push(error);
  };
  const admin = createDatabase({
    connectionString: postgresUrl,
    maxConnections: 1,
    onPoolError,
  });
  const url = new URL(postgresUrl);
  url.pathname = `/${name}`;
  try {
    await admin.pool.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    await admin.pool.end();
    throw error;
  }
  const client = createDatabase({
    connectionString: url.toString(),
    maxConnections: 2,
    onPoolError,
  });
  if (migrate) {
    try {
      await migrateDatabase({
        connectionString: url.toString(),
        onPoolError,
        migrationsFolder: fileURLToPath(
          new URL("../../../../packages/database/migrations/", import.meta.url),
        ),
      });
    } catch (error) {
      try {
        await client.pool.end();
        await admin.pool.query(`DROP DATABASE "${name}"`);
      } finally {
        await admin.pool.end();
      }
      throw error;
    }
  }
  return {
    ...client,
    connectionString: url.toString(),
    onPoolError,
    async close() {
      try {
        await client.pool.end();
        await admin.pool.query(`DROP DATABASE "${name}"`);
      } finally {
        await admin.pool.end();
      }
      if (errors.length > 0)
        throw new AggregateError(
          errors,
          "Unexpected test database pool errors",
        );
    },
  };
}

export function databaseFixture() {
  let database: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.close();
  });
  return () => {
    if (!database) throw new Error("Test database was not initialized");
    return database;
  };
}
