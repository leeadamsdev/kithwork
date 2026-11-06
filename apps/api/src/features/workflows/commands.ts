import {
  maxActiveWorkflowStatuses,
  type CreateWorkflowStatusInput,
  type UpdateWorkflowStatusInput,
  type WorkflowStatusInput,
} from "@kithwork/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../platform/database/types.js";
import { workflowStatus, statusScope } from "./access.js";
import { workflowConflict } from "./errors.js";
import { getWorkflow } from "./queries.js";
import {
  activeWorkflowStatuses,
  advanceWorkflow,
  requireWorkflowStatus,
  requireWorkflowVersion,
  withLockedWorkflow,
} from "./transaction.js";

export function createWorkflowStatus(
  db: Database,
  actorId: string,
  input: CreateWorkflowStatusInput,
) {
  return withLockedWorkflow(db, actorId, input, async (tx, version) => {
    requireWorkflowVersion(version, input.expectedWorkflowVersion);
    const active = await activeWorkflowStatuses(tx, input);
    if (active.length >= maxActiveWorkflowStatuses)
      throw workflowConflict("Active status limit reached");
    await tx.insert(workflowStatus).values({
      organisationId: input.organisationId,
      teamId: input.teamId,
      name: input.name,
      description: input.description,
      category: input.category,
      position: active.filter((row) => row.category === input.category).length,
    });
    await advanceWorkflow(tx, input);
    return getWorkflow(tx, actorId, input);
  });
}
export function updateWorkflowStatus(
  db: Database,
  actorId: string,
  input: UpdateWorkflowStatusInput,
) {
  return withLockedWorkflow(db, actorId, input, async (tx, version) => {
    requireWorkflowVersion(version, input.expectedWorkflowVersion);
    const row = await requireWorkflowStatus(tx, input);
    if (row.retiredAt)
      throw workflowConflict("Restore this status before changing it");
    const name = input.name ?? row.name;
    const description =
      input.description === undefined ? row.description : input.description;
    if (name !== row.name || description !== row.description) {
      await tx
        .update(workflowStatus)
        .set({ name, description, updatedAt: sql`clock_timestamp()` })
        .where(and(statusScope(input), eq(workflowStatus.id, row.id)));
      await advanceWorkflow(tx, input);
    }
    return getWorkflow(tx, actorId, input);
  });
}
export function setDefaultWorkflowStatus(
  db: Database,
  actorId: string,
  input: WorkflowStatusInput,
) {
  return withLockedWorkflow(db, actorId, input, async (tx, version) => {
    requireWorkflowVersion(version, input.expectedWorkflowVersion);
    const row = await requireWorkflowStatus(tx, input);
    if (
      row.retiredAt ||
      (row.category !== "backlog" && row.category !== "unstarted")
    )
      throw workflowConflict(
        "Default status must be active and in backlog or unstarted",
      );
    if (!row.isDefault) {
      await tx
        .update(workflowStatus)
        .set({ isDefault: false, updatedAt: sql`clock_timestamp()` })
        .where(and(statusScope(input), eq(workflowStatus.isDefault, true)));
      await tx
        .update(workflowStatus)
        .set({ isDefault: true, updatedAt: sql`clock_timestamp()` })
        .where(and(statusScope(input), eq(workflowStatus.id, row.id)));
      await advanceWorkflow(tx, input);
    }
    return getWorkflow(tx, actorId, input);
  });
}
