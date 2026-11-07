import { authSchema } from "@kithwork/database";
import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { organisationMember } from "../teams/access.js";
import { issueUnavailable } from "./errors.js";
import { eligibleIssueParticipantPredicate } from "./audience.js";

export async function requireAssignee(
  db: Database | Transaction,
  input: { organisationId: string; teamId: string },
  userId: string,
) {
  const [row] = await db
    .select({ id: authSchema.user.id, name: authSchema.user.name })
    .from(authSchema.user)
    .where(
      and(
        eq(authSchema.user.id, userId),
        eligibleIssueParticipantPredicate(
          input.organisationId,
          input.teamId,
          authSchema.user.id,
        ),
      ),
    );
  if (!row) throw issueUnavailable();
  return row;
}

export async function requireAssigneeFilter(
  db: Database,
  organisationId: string,
  userId: string,
) {
  const [row] = await db
    .select({ id: organisationMember.userId })
    .from(organisationMember)
    .where(
      and(
        eq(organisationMember.organisationId, organisationId),
        eq(organisationMember.userId, userId),
      ),
    );
  if (!row) throw issueUnavailable();
}
