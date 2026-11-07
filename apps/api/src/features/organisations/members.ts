import { authSchema, organisationsSchema } from "@kithwork/database";
import type { OrganisationRole } from "@kithwork/contracts";
import { and, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Database, Transaction } from "../../platform/database/types.js";
import { canChangeMemberRole, canRemoveMember } from "./policies.js";
import { withLockedOrganisation } from "./transaction.js";
import { missing, forbidden } from "./errors.js";
import { memberSummary, type MemberRow } from "./presentation.js";
import { cancelIssuedInvitations } from "./invitations/cancellation.js";
import { clearIssueAssignments } from "../issues/assignment-cleanup.js";
import { clearInaccessibleIssueSubscriptions } from "../issues/subscriptions/maintenance.js";
const { organisationMember } = organisationsSchema;
const { user } = authSchema;

async function targetMember(
  tx: Transaction,
  organisationId: string,
  userId: string,
) {
  const [row] = await tx
    .select({
      userId: user.id,
      name: user.name,
      role: organisationMember.role,
      joinedAt: organisationMember.createdAt,
    })
    .from(organisationMember)
    .innerJoin(user, eq(user.id, organisationMember.userId))
    .where(
      and(
        eq(organisationMember.organisationId, organisationId),
        eq(organisationMember.userId, userId),
      ),
    );
  if (!row) throw missing();
  return row;
}

async function preserveOwner(
  tx: Transaction,
  organisationId: string,
  target: MemberRow,
) {
  if (target.role !== "owner") return;
  const [other] = await tx
    .select({ userId: organisationMember.userId })
    .from(organisationMember)
    .where(
      and(
        eq(organisationMember.organisationId, organisationId),
        eq(organisationMember.role, "owner"),
        ne(organisationMember.userId, target.userId),
      ),
    )
    .limit(1);
  if (!other)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Appoint another owner before removing the last owner",
    });
}

export async function changeMemberRole(
  db: Database,
  actorId: string,
  organisationId: string,
  userId: string,
  role: OrganisationRole,
) {
  return withLockedOrganisation(
    db,
    actorId,
    organisationId,
    async (tx, access) => {
      if (!canChangeMemberRole(access.role)) throw forbidden();
      const target = await targetMember(tx, organisationId, userId);
      if (role !== "owner") await preserveOwner(tx, organisationId, target);
      await tx
        .update(organisationMember)
        .set({ role })
        .where(
          and(
            eq(organisationMember.organisationId, organisationId),
            eq(organisationMember.userId, userId),
          ),
        );
      await cancelIssuedInvitations(tx, organisationId, userId, role);
      if (target.role !== "member" && role === "member") {
        await clearIssueAssignments(
          tx,
          actorId,
          { organisationId, userId },
          "organisation_role_changed",
        );
        await clearInaccessibleIssueSubscriptions(tx, {
          organisationId,
          userId,
        });
      }
      return memberSummary({ ...target, role });
    },
  );
}

export async function removeMember(
  db: Database,
  actorId: string,
  organisationId: string,
  userId: string,
  leaving = false,
) {
  return withLockedOrganisation(
    db,
    actorId,
    organisationId,
    async (tx, access) => {
      const target = await targetMember(tx, organisationId, userId);
      if (
        leaving
          ? actorId !== userId
          : !canRemoveMember(access.role, target.role)
      )
        throw forbidden();
      await preserveOwner(tx, organisationId, target);
      await clearIssueAssignments(
        tx,
        actorId,
        { organisationId, userId },
        leaving ? "organisation_member_left" : "organisation_member_removed",
      );
      await tx
        .delete(organisationMember)
        .where(
          and(
            eq(organisationMember.organisationId, organisationId),
            eq(organisationMember.userId, userId),
          ),
        );
      await cancelIssuedInvitations(tx, organisationId, userId, null);
      return { success: true as const };
    },
  );
}
