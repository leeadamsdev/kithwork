import { issueSubscriptionsSchema } from "@kithwork/database";
import { and, eq, exists, sql } from "drizzle-orm";
import type { Database } from "../../../platform/database/types.js";
import {
  selectTeamAccess,
  team,
  teamReadPredicate,
} from "../../teams/access.js";
import { issue, issueScope, type IssueScope } from "../access.js";
import { issueUnavailable } from "../errors.js";
const { issueSubscription } = issueSubscriptionsSchema;

export async function getIssueFollowing(
  db: Database,
  actorId: string,
  input: IssueScope,
) {
  const [row] = await db
    .select({
      organisationId: issue.organisationId,
      issueId: issue.id,
      following: sql<boolean>`${exists(
        db
          .select({ id: issueSubscription.userId })
          .from(issueSubscription)
          .where(
            and(
              eq(issueSubscription.organisationId, issue.organisationId),
              eq(issueSubscription.issueId, issue.id),
              eq(issueSubscription.userId, actorId),
              eq(issueSubscription.state, "watching"),
            ),
          ),
      )}`,
    })
    .from(issue)
    .where(
      and(
        issueScope(input),
        exists(
          selectTeamAccess(db, actorId).where(
            and(
              eq(team.organisationId, issue.organisationId),
              eq(team.id, issue.teamId),
              teamReadPredicate(),
            ),
          ),
        ),
      ),
    );
  if (!row) throw issueUnavailable();
  return row;
}
