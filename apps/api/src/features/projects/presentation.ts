import type { projectsSchema } from "@kithwork/database";
export type ProjectRow = typeof projectsSchema.project.$inferSelect;
export function presentProject(
  row: ProjectRow,
  canEdit: boolean,
  canManage: boolean,
) {
  const active = row.archivedAt === null;
  return {
    id: row.id,
    organisationId: row.organisationId,
    name: row.name,
    description: row.description,
    status: row.status,
    startDate: row.startDate,
    targetDate: row.targetDate,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: {
      canEdit: active && canEdit,
      canManageTeams: active && canManage,
      canArchive: active && canManage,
      canRestore: !active && canManage,
    },
  };
}
