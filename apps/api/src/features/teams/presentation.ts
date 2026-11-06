import type { OrganisationRole, TeamRole } from "@kithwork/contracts";
import type { teamsSchema } from "@kithwork/database";
import { canManageTeam, isOrganisationAdministrator } from "./policies.js";

export type TeamRow = typeof teamsSchema.team.$inferSelect;
export function presentTeam(
  row: TeamRow,
  organisationRole: OrganisationRole,
  membershipRole: TeamRole | null,
) {
  const administrator = isOrganisationAdministrator(organisationRole);
  const manager = canManageTeam(organisationRole, membershipRole);
  const active = row.archivedAt === null;
  return {
    id: row.id,
    organisationId: row.organisationId,
    name: row.name,
    key: row.key,
    description: row.description,
    visibility: row.visibility,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    membershipRole,
    capabilities: {
      canEdit: active && manager,
      canChangeVisibility: active && administrator,
      canArchive: active && administrator,
      canRestore: !active && administrator,
      canAddMembers: active && manager,
      canChangeRoles: active && manager,
      canRemoveMembers: manager,
      canJoin:
        active && row.visibility === "organisation" && membershipRole === null,
      canLeave: membershipRole !== null,
    },
  };
}
