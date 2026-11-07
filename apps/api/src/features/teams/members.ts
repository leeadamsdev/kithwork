import type { TeamRole } from "@kithwork/contracts";
import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { organisationMember, teamMember } from "./access.js";
import { canManageTeam } from "./policies.js";
import { teamConflict, teamForbidden, teamUnavailable } from "./errors.js";
import { requireActiveTeam, withLockedTeam } from "./transaction.js";
import { clearIssueAssignments } from "../issues/assignment-cleanup.js";
import { clearInaccessibleIssueSubscriptions } from "../issues/subscriptions/maintenance.js";
import {
  findTeamMember,
  presentMember,
  requireTeamMember,
} from "./member-queries.js";

type MemberInput = { organisationId: string; teamId: string; userId: string };
async function insertMembership(
  tx: Transaction,
  input: MemberInput & { role: TeamRole },
) {
  const [member] = await tx
    .select({ id: organisationMember.userId })
    .from(organisationMember)
    .where(
      and(
        eq(organisationMember.organisationId, input.organisationId),
        eq(organisationMember.userId, input.userId),
      ),
    );
  if (!member) throw teamUnavailable();
  await tx.insert(teamMember).values(input);
  return presentMember(await requireTeamMember(tx, input));
}
export function addTeamMember(
  db: Database,
  actorId: string,
  input: MemberInput & { role: TeamRole },
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    if (!canManageTeam(access.organisationRole, access.membershipRole))
      throw teamForbidden();
    const existing = await findTeamMember(tx, input);
    if (existing) {
      if (existing.role !== input.role)
        throw teamConflict("Membership exists; use the role change action");
      return presentMember(existing);
    }
    requireActiveTeam(access.team);
    return insertMembership(tx, input);
  });
}
export function changeTeamMemberRole(
  db: Database,
  actorId: string,
  input: MemberInput & { role: TeamRole },
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    if (!canManageTeam(access.organisationRole, access.membershipRole))
      throw teamForbidden();
    const existing = await requireTeamMember(tx, input);
    if (existing.role === input.role) return presentMember(existing);
    requireActiveTeam(access.team);
    await tx
      .update(teamMember)
      .set({ role: input.role })
      .where(
        and(
          eq(teamMember.organisationId, input.organisationId),
          eq(teamMember.teamId, input.teamId),
          eq(teamMember.userId, input.userId),
        ),
      );
    return presentMember({ ...existing, role: input.role });
  });
}
export function removeTeamMember(
  db: Database,
  actorId: string,
  input: MemberInput,
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    if (!canManageTeam(access.organisationRole, access.membershipRole))
      throw teamForbidden();
    await deleteMembership(tx, input);
    await clearIssueAssignments(tx, actorId, input, "team_member_removed");
    await clearInaccessibleIssueSubscriptions(tx, input);
    return { success: true as const };
  });
}
export function joinTeam(
  db: Database,
  actorId: string,
  input: { organisationId: string; teamId: string },
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    const target = { ...input, userId: actorId };
    const existing = await findTeamMember(tx, target);
    if (existing) return presentMember(existing);
    if (access.team.visibility !== "organisation") throw teamForbidden();
    requireActiveTeam(access.team);
    return insertMembership(tx, { ...target, role: "member" });
  });
}
export function leaveTeam(
  db: Database,
  actorId: string,
  input: { organisationId: string; teamId: string },
) {
  return withLockedTeam(db, actorId, input, async (tx) => {
    await deleteMembership(tx, { ...input, userId: actorId });
    await clearIssueAssignments(
      tx,
      actorId,
      { ...input, userId: actorId },
      "team_member_left",
    );
    await clearInaccessibleIssueSubscriptions(tx, {
      ...input,
      userId: actorId,
    });
    return { success: true as const };
  });
}
async function deleteMembership(tx: Transaction, input: MemberInput) {
  await tx
    .delete(teamMember)
    .where(
      and(
        eq(teamMember.organisationId, input.organisationId),
        eq(teamMember.teamId, input.teamId),
        eq(teamMember.userId, input.userId),
      ),
    );
}
