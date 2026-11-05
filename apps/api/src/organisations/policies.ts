import type { OrganisationRole } from "@kithwork/contracts";

export function canUpdateOrganisation(role: OrganisationRole): boolean {
  return role === "owner" || role === "admin";
}
export function canChangeMemberRole(role: OrganisationRole): boolean {
  return role === "owner";
}
export function canRemoveMember(
  actor: OrganisationRole,
  target: OrganisationRole,
): boolean {
  return actor === "owner" || (actor === "admin" && target === "member");
}
