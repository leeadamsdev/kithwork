import {
  maxActiveWorkflowStatuses,
  type WorkflowStatusInput,
} from "@kithwork/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../platform/database/types.js";
import { statusScope, workflowStatus } from "./access.js";
import { workflowConflict } from "./errors.js";
import { applyWorkflowOrder } from "./ordering.js";
import { getWorkflow } from "./queries.js";
import {
  activeWorkflowStatuses,
  advanceWorkflow,
  requireWorkflowStatus,
  requireWorkflowVersion,
  withLockedWorkflow,
} from "./transaction.js";

export function setWorkflowStatusRetired(
  db: Database,
  actorId: string,
  input: WorkflowStatusInput,
  retired: boolean,
) {
  return withLockedWorkflow(db, actorId, input, async (tx, version) => {
    const row = await requireWorkflowStatus(tx, input);
    if ((row.retiredAt !== null) === retired)
      return getWorkflow(tx, actorId, input);
    requireWorkflowVersion(version, input.expectedWorkflowVersion);
    const active = await activeWorkflowStatuses(tx, input);
    const category = active.filter(
      (status) => status.category === row.category,
    );
    if (retired) {
      if (row.isDefault)
        throw workflowConflict(
          "Choose another default before retiring this status",
        );
      if (category.length <= 1)
        throw workflowConflict("Each category requires an active status");
      await tx
        .update(workflowStatus)
        .set({ retiredAt: new Date(), updatedAt: sql`clock_timestamp()` })
        .where(and(statusScope(input), eq(workflowStatus.id, row.id)));
      const remaining = category.filter((status) => status.id !== row.id);
      await applyWorkflowOrder(
        tx,
        input,
        remaining,
        remaining.map((status) => status.id),
      );
    } else {
      if (active.length >= maxActiveWorkflowStatuses)
        throw workflowConflict("Active status limit reached");
      await tx
        .update(workflowStatus)
        .set({
          retiredAt: null,
          position: category.length,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(and(statusScope(input), eq(workflowStatus.id, row.id)));
    }
    await advanceWorkflow(tx, input);
    return getWorkflow(tx, actorId, input);
  });
}
