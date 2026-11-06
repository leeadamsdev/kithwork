import { sql } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";

export const invitationLifetimeMs = 7 * 86_400_000;
export const resendCooldownMs = 60_000;
export const currentTimeMs = sql<number>`floor(extract(epoch from clock_timestamp()) * 1000)::double precision`;

export async function invitationTime(db: Database | Transaction) {
  const result = await db.execute<{ now: number }>(
    sql`select ${currentTimeMs} as now`,
  );
  return result.rows[0]!.now;
}
