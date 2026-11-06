import {
  issueStoredChangesSchema,
  issueActivityCauseSchema,
  type IssueActivityPageInput,
} from "@kithwork/contracts";
import { issueActivitySchema } from "@kithwork/database";
import { and, eq, exists, gt } from "drizzle-orm";
import type { Database } from "../../platform/database/types.js";
import { teamReadPredicate } from "../teams/access.js";
import { issueScope, readIssueAccess, selectIssueAccess } from "./access.js";
import { resolveIssueActivityChanges } from "./activity-references.js";

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
  const page = rows.slice(0, input.limit).map((row) => ({
    ...row,
    changes: issueStoredChangesSchema.parse(row.changes),
  }));
  const changes = await resolveIssueActivityChanges(
    db,
    actorId,
    input.organisationId,
    page.map((row) => row.changes),
  );
  const items = page.map((row, index) => {
    return {
      id: row.id,
      organisationId: row.organisationId,
      issueId: row.issueId,
      issueVersion: row.issueVersion,
      actor: { id: row.actorId, name: row.actorName },
      kind: row.kind,
      cause: issueActivityCauseSchema.parse(row.cause),
      createdAt: row.createdAt.toISOString(),
      changes: changes[index]!,
    };
  });
  return {
    items,
    nextCursor: rows.length > input.limit ? items.at(-1)!.issueVersion : null,
  };
}
