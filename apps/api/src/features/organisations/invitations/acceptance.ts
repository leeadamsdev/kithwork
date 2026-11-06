import type { AuthenticatedUser, InvitationRole } from "@kithwork/contracts";
import { invitationsSchema, organisationsSchema } from "@kithwork/database";
import { and, eq } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import { invitationUnavailable } from "../errors.js";
import { withOrganisationLock } from "../transaction.js";
import { loadOrganisationAccess } from "../access.js";
import { canGrantInvitation } from "./policies.js";
import { currentTimeMs, invitationTime } from "./timing.js";
import { loadInvitation } from "./queries.js";
import { matchesInvitationToken } from "./tokens.js";
import { cancelInvitationEmails } from "./email.js";

const { organisationInvitation: invitation } = invitationsSchema;
const { organisation, organisationMember } = organisationsSchema;

async function requireIssuerAuthority(
  db: Database | Transaction,
  organisationId: string,
  issuerId: string,
  role: InvitationRole,
) {
  const [issuer] = await db
    .select({ role: organisationMember.role })
    .from(organisationMember)
    .where(
      and(
        eq(organisationMember.organisationId, organisationId),
        eq(organisationMember.userId, issuerId),
      ),
    );
  if (!issuer || !canGrantInvitation(issuer.role, role))
    throw invitationUnavailable();
}

export async function previewInvitation(
  db: Database,
  actor: AuthenticatedUser,
  invitationId: string,
) {
  const [row] = await db
    .select({
      id: invitation.id,
      organisationId: invitation.organisationId,
      organisationName: organisation.name,
      role: invitation.role,
      issuerId: invitation.issuerId,
      expiresAt: invitation.expiresAt,
      status: invitation.status,
      now: currentTimeMs,
    })
    .from(invitation)
    .innerJoin(organisation, eq(organisation.id, invitation.organisationId))
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.email, actor.email.toLowerCase()),
      ),
    );
  if (!row || row.status !== "pending" || row.expiresAt.getTime() <= row.now)
    throw invitationUnavailable();
  await requireIssuerAuthority(db, row.organisationId, row.issuerId, row.role);
  return {
    id: row.id,
    organisationId: row.organisationId,
    organisationName: row.organisationName,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function acceptInvitation(
  db: Database,
  actor: AuthenticatedUser,
  input: { invitationId: string; token: string },
) {
  const [target] = await db
    .select({ organisationId: invitation.organisationId })
    .from(invitation)
    .where(
      and(
        eq(invitation.id, input.invitationId),
        eq(invitation.email, actor.email.toLowerCase()),
      ),
    );
  if (!target) throw invitationUnavailable();
  return withOrganisationLock(db, target.organisationId, async (tx) => {
    const row = await loadInvitation(
      tx,
      target.organisationId,
      input.invitationId,
    );
    if (
      row.email !== actor.email.toLowerCase() ||
      !matchesInvitationToken(input.token, row.tokenHash)
    )
      throw invitationUnavailable();
    // A retry returns existing access; it never recreates a membership removed later.
    if (row.status === "accepted" && row.acceptedBy === actor.id)
      return loadOrganisationAccess(tx, actor.id, row.organisationId);
    const now = await invitationTime(tx);
    if (row.status !== "pending" || row.expiresAt.getTime() <= now)
      throw invitationUnavailable();
    await requireIssuerAuthority(
      tx,
      row.organisationId,
      row.issuerId,
      row.role,
    );
    await tx
      .insert(organisationMember)
      .values({
        organisationId: row.organisationId,
        userId: actor.id,
        role: row.role,
      })
      .onConflictDoNothing({
        target: [organisationMember.organisationId, organisationMember.userId],
      });
    await tx
      .update(invitation)
      .set({
        status: "accepted",
        acceptedBy: actor.id,
        acceptedAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(eq(invitation.id, row.id));
    await cancelInvitationEmails(tx, row.id);
    return loadOrganisationAccess(tx, actor.id, row.organisationId);
  });
}
