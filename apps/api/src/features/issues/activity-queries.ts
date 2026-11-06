import {
  issueChangesSchema,
  type IssueActivityPageInput,
} from "@kithwork/contracts";
import { issueActivitySchema } from "@kithwork/database";
import { and, eq, exists, gt } from "drizzle-orm";
import type { Database } from "../../platform/database/types.js";
import { teamReadPredicate } from "../teams/access.js";
import { issueScope, readIssueAccess, selectIssueAccess } from "./access.js";

const { issueActivity } = issueActivitySchema;
export async function listIssueActivity(
  db: Database,
  actorId: string,
  input: IssueActivityPageInput,
) {
  await readIssueAccess(db, actorId, input);
  const rows = await db
    .select()
    .from(issueActivity)
    .where(
      and(
        eq(issueActivity.organisationId, input.organisationId),
        eq(issueActivity.issueId, input.issueId),
        exists(
          selectIssueAccess(db, actorId).where(
            and(issueScope(input), teamReadPredicate()),
          ),
        ),
        input.cursor ? gt(issueActivity.issueVersion, input.cursor) : undefined,
      ),
    )
    .orderBy(issueActivity.issueVersion)
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map((row) => ({
    id: row.id,
    organisationId: row.organisationId,
    issueId: row.issueId,
    issueVersion: row.issueVersion,
    actor: { id: row.actorId, name: row.actorName },
    kind: row.kind,
    cause: "user" as const,
    createdAt: row.createdAt.toISOString(),
    changes: issueChangesSchema.parse(row.changes),
  }));
  return {
    items,
    nextCursor: rows.length > input.limit ? items.at(-1)!.issueVersion : null,
  };
}
