import type { SetIssueFollowingInput } from "@kithwork/contracts";
import { issueSubscriptionsSchema } from "@kithwork/database";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import { organisationMember } from "../../teams/access.js";
import { issue, issueScope, type IssueScope } from "../access.js";
import { eligibleIssueParticipantPredicate } from "../audience.js";
import { withLockedIssue } from "../transaction.js";
const { issueSubscription } = issueSubscriptionsSchema;

export async function autoFollowIssue(
  tx: Transaction,
  scope: IssueScope,
  userIds: string[],
) {
  if (!userIds.length) return;
  await tx
    .insert(issueSubscription)
    .select(
      tx
        .select({
          organisationId: issue.organisationId,
          issueId: issue.id,
          userId: organisationMember.userId,
          state: sql<"watching">`'watching'`.as("state"),
          createdAt: sql<Date>`clock_timestamp()`.as("created_at"),
          updatedAt: sql<Date>`clock_timestamp()`.as("updated_at"),
        })
        .from(issue)
        .innerJoin(
          organisationMember,
          and(
            eq(organisationMember.organisationId, issue.organisationId),
            inArray(organisationMember.userId, userIds),
          ),
        )
        .where(
          and(
            issueScope(scope),
            eligibleIssueParticipantPredicate(
              issue.organisationId,
              issue.teamId,
              organisationMember.userId,
            ),
          ),
        ),
    )
    .onConflictDoNothing();
}

export function setIssueFollowing(
  db: Database,
  actorId: string,
  input: SetIssueFollowingInput,
) {
  return withLockedIssue(db, actorId, input, async (tx, access) => {
    const state = input.following ? "watching" : "muted";
    await tx
      .insert(issueSubscription)
      .values({
        organisationId: access.issue.organisationId,
        issueId: access.issue.id,
        userId: actorId,
        state,
      })
      .onConflictDoUpdate({
        target: [
          issueSubscription.organisationId,
          issueSubscription.issueId,
          issueSubscription.userId,
        ],
        set: { state, updatedAt: sql`clock_timestamp()` },
        setWhere: ne(issueSubscription.state, state),
      });
    return {
      organisationId: access.issue.organisationId,
      issueId: access.issue.id,
      following: input.following,
    };
  });
}
