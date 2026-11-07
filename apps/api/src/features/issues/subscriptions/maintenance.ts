import { issueSubscriptionsSchema } from "@kithwork/database";
import { and, eq, exists, not } from "drizzle-orm";
import type { Transaction } from "../../../platform/database/types.js";
import { issue } from "../access.js";
import { eligibleIssueParticipantPredicate } from "../audience.js";
const { issueSubscription } = issueSubscriptionsSchema;

// Administration already holds the exclusive organisation barrier; do not reacquire issue locks here.
export async function clearInaccessibleIssueSubscriptions(
  tx: Transaction,
  scope: { organisationId: string; teamId?: string; userId?: string },
) {
  await tx.delete(issueSubscription).where(
    and(
      eq(issueSubscription.organisationId, scope.organisationId),
      eq(issueSubscription.state, "watching"),
      scope.userId ? eq(issueSubscription.userId, scope.userId) : undefined,
      exists(
        tx
          .select({ id: issue.id })
          .from(issue)
          .where(
            and(
              eq(issue.organisationId, issueSubscription.organisationId),
              eq(issue.id, issueSubscription.issueId),
              scope.teamId ? eq(issue.teamId, scope.teamId) : undefined,
              not(
                eligibleIssueParticipantPredicate(
                  issue.organisationId,
                  issue.teamId,
                  issueSubscription.userId,
                ),
              ),
            ),
          ),
      ),
    ),
  );
}
