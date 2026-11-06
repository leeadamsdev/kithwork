import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  authSchema,
  invitationsSchema,
  organisationsSchema,
} from "@kithwork/database";
import type { InvitationRole } from "@kithwork/contracts";
import { and, eq, ne, sql } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import { forbidden } from "../errors.js";
import { withLockedOrganisation } from "../transaction.js";
import { canGrantInvitation, canManageInvitations } from "./policies.js";
import { createInvitationToken } from "./tokens.js";
import {
  invitationLifetimeMs,
  invitationTime,
  resendCooldownMs,
} from "./timing.js";
import { invitationSummary, loadInvitation } from "./queries.js";
import {
  cancelInvitationEmails,
  storeInvitationEmail,
  type InvitationEmailConfig,
} from "./email.js";

const { organisationInvitation: invitation } = invitationsSchema;
const { organisationMember } = organisationsSchema;

async function ensureNotMember(
  tx: Transaction,
  organisationId: string,
  email: string,
) {
  const [member] = await tx
    .select({ id: authSchema.user.id })
    .from(organisationMember)
    .innerJoin(
      authSchema.user,
      eq(authSchema.user.id, organisationMember.userId),
    )
    .where(
      and(
        eq(organisationMember.organisationId, organisationId),
        sql`lower(${authSchema.user.email}) = ${email}`,
      ),
    )
    .limit(1);
  if (member)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This person is already an organisation member",
    });
}

export async function createInvitation(
  db: Database,
  actorId: string,
  input: { organisationId: string; email: string; role: InvitationRole },
  config: InvitationEmailConfig,
  requestId: string,
) {
  return withLockedOrganisation(
    db,
    actorId,
    input.organisationId,
    async (tx, access) => {
      if (!canGrantInvitation(access.role, input.role)) throw forbidden();
      await ensureNotMember(tx, input.organisationId, input.email);
      const now = await invitationTime(tx);
      const [pending] = await tx
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.organisationId, input.organisationId),
            eq(invitation.email, input.email),
            eq(invitation.status, "pending"),
          ),
        );
      if (pending) {
        if (pending.expiresAt.getTime() > now)
          throw new TRPCError({
            code: "CONFLICT",
            message: "A pending invitation already exists",
          });
        await tx
          .update(invitation)
          .set({ status: "expired", updatedAt: new Date(now) })
          .where(eq(invitation.id, pending.id));
        await cancelInvitationEmails(tx, pending.id);
      }
      const id = randomUUID();
      const token = createInvitationToken();
      const expiresAt = new Date(now + invitationLifetimeMs);
      await tx.insert(invitation).values({
        id,
        ...input,
        issuerId: actorId,
        tokenHash: token.hash,
        expiresAt,
        lastIssuedAt: new Date(now),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      });
      await storeInvitationEmail(tx, config, {
        invitationId: id,
        version: 1,
        organisationName: access.name,
        email: input.email,
        expiresAt,
        token: token.token,
        requestId,
      });
      return invitationSummary(tx, input.organisationId, id);
    },
  );
}

export async function resendInvitation(
  db: Database,
  actorId: string,
  input: { organisationId: string; invitationId: string },
  config: InvitationEmailConfig,
  requestId: string,
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
      if (row.status !== "pending" && row.status !== "expired")
        throw new TRPCError({
          code: "CONFLICT",
          message: "This invitation cannot be resent",
        });
      const now = await invitationTime(tx);
      if (row.lastIssuedAt.getTime() + resendCooldownMs > now)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Wait before resending this invitation",
        });
      await ensureNotMember(tx, input.organisationId, row.email);
      const [other] = await tx
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.organisationId, input.organisationId),
            eq(invitation.email, row.email),
            eq(invitation.status, "pending"),
            ne(invitation.id, row.id),
          ),
        )
        .limit(1);
      if (other)
        throw new TRPCError({
          code: "CONFLICT",
          message: "A newer invitation already exists",
        });
      const token = createInvitationToken();
      const expiresAt = new Date(now + invitationLifetimeMs);
      const version = row.version + 1;
      await cancelInvitationEmails(tx, row.id);
      await tx
        .update(invitation)
        .set({
          status: "pending",
          tokenHash: token.hash,
          issuerId: actorId,
          version,
          expiresAt,
          lastIssuedAt: new Date(now),
          updatedAt: new Date(now),
        })
        .where(eq(invitation.id, row.id));
      await storeInvitationEmail(tx, config, {
        invitationId: row.id,
        version,
        organisationName: access.name,
        email: row.email,
        expiresAt,
        token: token.token,
        requestId,
      });
      return invitationSummary(tx, input.organisationId, row.id);
    },
  );
}
