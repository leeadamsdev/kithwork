import { and, eq, exists, lt, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { withSharedOrganisationAccess } from "../organisations/transaction.js";
import { team, selectTeamAccess, teamReadPredicate } from "../teams/access.js";
import {
  issue,
  issueScope,
  readIssueAccess,
  workflowStatus,
  type IssueAccess,
  type IssueScope,
  type IssueRow,
} from "./access.js";
import { issueConflict, issueUnavailable } from "./errors.js";

export function withLockedIssue<T>(
  db: Database,
  actorId: string,
  input: IssueScope,
  action: (tx: Transaction, row: IssueAccess) => Promise<T>,
) {
  return withSharedOrganisationAccess(
    db,
    actorId,
    input.organisationId,
    async (tx) => {
      // Status can change while waiting: lock using stable team visibility, not a join to the old status.
      const [row] = await tx
        .select({ id: issue.id })
        .from(issue)
        .where(
          and(
            issueScope(input),
            exists(
              selectTeamAccess(tx, actorId).where(
                and(
                  eq(team.organisationId, issue.organisationId),
                  eq(team.id, issue.teamId),
                  teamReadPredicate(),
                ),
              ),
            ),
          ),
        )
        .for("update");
      if (!row) throw issueUnavailable();
      // A waited-on issue may now reference another status; load its joined projection after locking.
      return action(tx, await readIssueAccess(tx, actorId, input));
    },
  );
}
export function requireIssueVersion(row: IssueRow, expected: number) {
  if (row.version !== expected)
    throw issueConflict("Issue has changed; refresh and retry");
}
export function requireActiveIssue(row: Pick<IssueRow, "archivedAt">) {
  if (row.archivedAt)
    throw issueConflict("Restore this issue before changing it");
}
export async function requireActiveStatus(
  tx: Transaction,
  input: { organisationId: string; teamId: string },
  statusId?: string,
) {
  const [row] = await tx
    .select({
      id: workflowStatus.id,
      name: workflowStatus.name,
      category: workflowStatus.category,
      retiredAt: workflowStatus.retiredAt,
    })
    .from(workflowStatus)
    .where(
      and(
        eq(workflowStatus.organisationId, input.organisationId),
        eq(workflowStatus.teamId, input.teamId),
        statusId
          ? eq(workflowStatus.id, statusId)
          : eq(workflowStatus.isDefault, true),
      ),
    );
  if (!row) throw issueUnavailable();
  if (row.retiredAt) throw issueConflict("Choose an active workflow status");
  return row;
}
export async function saveIssue(
  tx: Transaction,
  row: IssueRow,
  values: Partial<
    Pick<
      IssueRow,
      | "title"
      | "description"
      | "statusId"
      | "priority"
      | "dueDate"
      | "archivedAt"
      | "assigneeId"
      | "projectId"
    >
  >,
) {
  const [updated] = await tx
    .update(issue)
    .set({
      ...values,
      version: sql`${issue.version}+1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(issue.organisationId, row.organisationId),
        eq(issue.id, row.id),
        lt(issue.version, 2147483647),
      ),
    )
    .returning();
  if (!updated) throw issueConflict("Issue version limit reached");
  return updated;
}
