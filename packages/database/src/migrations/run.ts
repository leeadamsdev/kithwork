import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "../client.js";
import type { DatabaseOptions } from "../client.js";

export interface MigrationOptions extends Omit<
  DatabaseOptions,
  "maxConnections"
> {
  migrationsFolder: string;
}

export async function migrateDatabase({
  migrationsFolder,
  ...options
}: MigrationOptions): Promise<void> {
  const { db, pool } = createDatabase({ ...options, maxConnections: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
