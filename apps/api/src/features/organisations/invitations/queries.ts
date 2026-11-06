import { invitationsSchema, outboxSchema } from "@kithwork/database";
import { and, eq, gt } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import { invitationUnavailable } from "../errors.js";
import { currentTimeMs, resendCooldownMs } from "./timing.js";

const { organisationInvitation: invitation } = invitationsSchema;
const { emailOutbox: outbox } = outboxSchema;

export async function loadInvitation(
  tx: Transaction,
  organisationId: string,
  invitationId: string,
) {
  // Retention runs outside the organisation lock and must not delete this row mid-mutation.
  const [row] = await tx
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.organisationId, organisationId),
        eq(invitation.id, invitationId),
      ),
    )
    .for("update");
  if (!row) throw invitationUnavailable();
  return row;
}

function selectSummaries(db: Database | Transaction) {
  return db
    .select({
      id: invitation.id,
      organisationId: invitation.organisationId,
      email: invitation.email,
      role: invitation.role,
      issuerId: invitation.issuerId,
      status: invitation.status,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      lastIssuedAt: invitation.lastIssuedAt,
      outcome: outbox.outcome,
      now: currentTimeMs,
    })
    .from(invitation)
    .leftJoin(
      outbox,
      and(
        eq(outbox.invitationId, invitation.id),
        eq(outbox.invitationVersion, invitation.version),
      ),
    );
}

function present(row: Awaited<ReturnType<typeof selectSummaries>>[number]) {
  return {
    id: row.id,
    organisationId: row.organisationId,
    email: row.email,
    role: row.role,
    issuerId: row.issuerId,
    status:
      row.status === "pending" && row.expiresAt.getTime() <= row.now
        ? ("expired" as const)
        : row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    resendAvailableAt: new Date(
      row.lastIssuedAt.getTime() + resendCooldownMs,
    ).toISOString(),
    emailStatus: row.outcome ?? ("pending" as const),
  };
}

export async function invitationSummary(
  db: Database | Transaction,
  organisationId: string,
  invitationId: string,
) {
  const [row] = await selectSummaries(db).where(
    and(
      eq(invitation.organisationId, organisationId),
      eq(invitation.id, invitationId),
    ),
  );
  if (!row) throw invitationUnavailable();
  return present(row);
}

export async function listInvitations(
  db: Database,
  organisationId: string,
  input: { cursor?: string | undefined; limit: number },
) {
  const rows = await selectSummaries(db)
    .where(
      and(
        eq(invitation.organisationId, organisationId),
        input.cursor ? gt(invitation.id, input.cursor) : undefined,
      ),
    )
    .orderBy(invitation.id)
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map(present);
  return {
    items,
    nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
  };
}
