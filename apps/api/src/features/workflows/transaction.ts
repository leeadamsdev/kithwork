import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { canManageTeam } from "../teams/policies.js";
import { requireActiveTeam, withLockedTeam } from "../teams/transaction.js";
import {
  teamWorkflow,
  workflowStatus,
  workflowScope,
  statusScope,
  type WorkflowScope,
} from "./access.js";
import {
  rethrowWorkflowWriteError,
  workflowConflict,
  workflowForbidden,
  workflowUnavailable,
} from "./errors.js";

export function withLockedWorkflow<T>(
  db: Database,
  actorId: string,
  input: WorkflowScope,
  action: (tx: Transaction, version: number) => Promise<T>,
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    if (!canManageTeam(access.organisationRole, access.membershipRole))
      throw workflowForbidden();
    requireActiveTeam(access.team);
    const [workflow] = await tx
      .select({ version: teamWorkflow.version })
      .from(teamWorkflow)
      .where(workflowScope(input))
      .for("update");
    if (!workflow) throw workflowUnavailable();
    return action(tx, workflow.version);
  }).catch(rethrowWorkflowWriteError);
}
export function requireWorkflowVersion(version: number, expected: number) {
  if (version !== expected)
    throw workflowConflict("Workflow has changed; refresh and retry");
}
export async function advanceWorkflow(tx: Transaction, input: WorkflowScope) {
  const [row] = await tx
    .update(teamWorkflow)
    .set({
      version: sql`${teamWorkflow.version}+1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(and(workflowScope(input), lt(teamWorkflow.version, 2147483647)))
    .returning({ version: teamWorkflow.version });
  if (!row) throw workflowConflict("Workflow version limit reached");
}
export async function requireWorkflowStatus(
  tx: Transaction,
  input: WorkflowScope & { statusId: string },
) {
  const [row] = await tx
    .select()
    .from(workflowStatus)
    .where(and(statusScope(input), eq(workflowStatus.id, input.statusId)));
  if (!row) throw workflowUnavailable();
  return row;
}
export function activeWorkflowStatuses(tx: Transaction, input: WorkflowScope) {
  return tx
    .select()
    .from(workflowStatus)
    .where(and(statusScope(input), isNull(workflowStatus.retiredAt)))
    .orderBy(
      workflowStatus.category,
      workflowStatus.position,
      workflowStatus.id,
    );
}
