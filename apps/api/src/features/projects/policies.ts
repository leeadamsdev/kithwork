import type { OrganisationRole, TeamRole } from "@kithwork/contracts";
import { isOrganisationAdministrator } from "../teams/policies.js";

export function canEditProject(
  role: OrganisationRole,
  teamRoles: (TeamRole | null)[],
) {
  return isOrganisationAdministrator(role) || teamRoles.includes("maintainer");
}
export function canManageProject(
  role: OrganisationRole,
  teamRoles: (TeamRole | null)[],
) {
  return (
    isOrganisationAdministrator(role) ||
    (teamRoles.length > 0 && teamRoles.every((value) => value === "maintainer"))
  );
}
