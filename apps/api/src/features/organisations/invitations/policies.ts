import type { InvitationRole, OrganisationRole } from "@kithwork/contracts";

export function canManageInvitations(role: OrganisationRole): boolean {
  return role === "owner" || role === "admin";
}

export function canGrantInvitation(
  actor: OrganisationRole,
  target: InvitationRole,
): boolean {
  return actor === "owner" || (actor === "admin" && target === "member");
}
