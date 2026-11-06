import type { workflowsSchema } from "@kithwork/database";
export type WorkflowStatusRow =
  typeof workflowsSchema.workflowStatus.$inferSelect;
export function presentWorkflowStatus(row: WorkflowStatusRow) {
  return {
    id: row.id,
    organisationId: row.organisationId,
    teamId: row.teamId,
    name: row.name,
    description: row.description,
    category: row.category,
    position: row.position,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    retiredAt: row.retiredAt?.toISOString() ?? null,
  };
}
