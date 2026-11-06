import { TRPCError } from "@trpc/server";
import { invitationsSchema } from "@kithwork/database";
import type { OrganisationRole } from "@kithwork/contracts";
import { eq, sql } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import { withLockedOrganisation } from "../transaction.js";
import { forbidden } from "../errors.js";
import { canGrantInvitation, canManageInvitations } from "./policies.js";
import { loadInvitation, invitationSummary } from "./queries.js";
import { cancelInvitationEmails } from "./email.js";

export async function cancelIssuedInvitations(
  tx: Transaction,
  organisationId: string,
  issuerId: string,
  newRole: OrganisationRole | null,
) {
  if (newRole === "owner") return;
  // Keep revocation and payload cleanup in the membership writer's transaction.
  await tx.execute(sql`with revoked as (
    update organisation_invitation set status='revoked',updated_at=clock_timestamp()
    where organisation_id=${organisationId} and issuer_id=${issuerId} and status='pending'
      ${newRole === "admin" ? sql`and role='admin'` : sql``}
    returning id
  ) update email_outbox set payload=null,outcome='skipped',last_error_code='obsolete',
    completed_at=clock_timestamp(),publish_lease_id=null,publish_lease_until=null,
    delivery_lease_id=null,delivery_lease_until=null
    where completed_at is null and invitation_id in (select id from revoked)`);
}

export async function revokeInvitation(
  db: Database,
  actorId: string,
  input: { organisationId: string; invitationId: string },
) {
  return withLockedOrganisation(
    db,
    actorId,
    input.organisationId,
    async (tx, access) => {
      if (!canManageInvitations(access.role)) throw forbidden();
      const row = await loadInvitation(
        tx,
        input.organisationId,
        input.invitationId,
      );
      if (!canGrantInvitation(access.role, row.role)) throw forbidden();
      if (row.status === "accepted")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Accepted invitations cannot be revoked",
        });
      await tx
        .update(invitationsSchema.organisationInvitation)
        .set({ status: "revoked" })
        .where(eq(invitationsSchema.organisationInvitation.id, row.id));
      await cancelInvitationEmails(tx, row.id);
      return invitationSummary(tx, input.organisationId, row.id);
    },
  );
}
