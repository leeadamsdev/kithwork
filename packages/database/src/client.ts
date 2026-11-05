import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export interface DatabaseOptions {
  connectionString: string;
  maxConnections?: number;
  statementTimeoutMs?: number;
  onPoolError: (error: Error) => void;
}

export function createDatabase({
  connectionString,
  maxConnections = 10,
  statementTimeoutMs,
  onPoolError,
}: DatabaseOptions) {
  const pool = new Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: 5_000,
    ...(statementTimeoutMs !== undefined
      ? { statement_timeout: statementTimeoutMs }
      : {}),
  });
  pool.on("error", onPoolError);
  const db = drizzle({ client: pool });
  return { db, pool };
}
