import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export interface DatabaseOptions {
  connectionString: string;
  maxConnections?: number;
  onPoolError: (error: Error) => void;
}

export function createDatabase({
  connectionString,
  maxConnections = 10,
  onPoolError,
}: DatabaseOptions) {
  const pool = new Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", onPoolError);
  const db = drizzle({ client: pool });
  return { db, pool };
}
