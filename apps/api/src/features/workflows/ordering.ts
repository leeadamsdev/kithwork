import type { ReorderWorkflowStatusesInput } from "@kithwork/contracts";
import { and, inArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { statusScope, workflowStatus, type WorkflowScope } from "./access.js";
import { workflowConflict } from "./errors.js";
import { getWorkflow } from "./queries.js";
import type { WorkflowStatusRow } from "./presentation.js";
import {
  activeWorkflowStatuses,
  advanceWorkflow,
  requireWorkflowVersion,
  withLockedWorkflow,
} from "./transaction.js";

export async function applyWorkflowOrder(
  tx: Transaction,
  input: WorkflowScope,
  rows: WorkflowStatusRow[],
  ids: string[],
) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  const changed = rows.filter((row) => row.position !== positions.get(row.id));
  if (!changed.length) return false;
  await tx
    .update(workflowStatus)
    .set({
      position: sql`case ${workflowStatus.id} ${sql.join(
        changed.map(
          (row) =>
            sql`when ${row.id}::uuid then ${positions.get(row.id)!}::integer`,
        ),
        sql` `,
      )} end`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        statusScope(input),
        inArray(
          workflowStatus.id,
          changed.map((row) => row.id),
        ),
      ),
    );
  return true;
}
export function reorderWorkflowStatuses(
  db: Database,
  actorId: string,
  input: ReorderWorkflowStatusesInput,
) {
  return withLockedWorkflow(db, actorId, input, async (tx, version) => {
    requireWorkflowVersion(version, input.expectedWorkflowVersion);
    const category = (await activeWorkflowStatuses(tx, input)).filter(
      (row) => row.category === input.category,
    );
    const ids = new Set<string>(input.statusIds);
    if (
      category.length !== ids.size ||
      category.some((row) => !ids.has(row.id))
    )
      throw workflowConflict("Provide every active status in this category");
    if (await applyWorkflowOrder(tx, input, category, input.statusIds))
      await advanceWorkflow(tx, input);
    return getWorkflow(tx, actorId, input);
  });
}
