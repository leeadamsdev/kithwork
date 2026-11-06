import type {
  OrganisationRole,
  TeamRole,
  TeamVisibility,
} from "@kithwork/contracts";

export function isOrganisationAdministrator(role: OrganisationRole): boolean {
  return role === "owner" || role === "admin";
}
export function canReadTeam(
  role: OrganisationRole,
  visibility: TeamVisibility,
  membership: TeamRole | null,
): boolean {
  return (
    isOrganisationAdministrator(role) ||
    visibility === "organisation" ||
    membership !== null
  );
}
export function canManageTeam(
  role: OrganisationRole,
  membership: TeamRole | null,
): boolean {
  return isOrganisationAdministrator(role) || membership === "maintainer";
}
