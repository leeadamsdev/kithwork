import { lt, sql } from "drizzle-orm";
import type { Transaction } from "../../platform/database/types.js";
import { issueCounter } from "./access.js";
import { issueConflict } from "./errors.js";

export async function allocateIssueNumber(
  tx: Transaction,
  organisationId: string,
  teamId: string,
): Promise<number> {
  const [row] = await tx
    .insert(issueCounter)
    .values({ organisationId, teamId, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [issueCounter.organisationId, issueCounter.teamId],
      set: { lastNumber: sql`${issueCounter.lastNumber}+1` },
      setWhere: lt(issueCounter.lastNumber, 2147483647),
    })
    .returning({ number: issueCounter.lastNumber });
  if (!row) throw issueConflict("Team issue number limit reached");
  return row.number;
}
