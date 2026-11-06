import type { IssueCleanupCause } from "@kithwork/contracts";
import { authSchema } from "@kithwork/database";
import { and, eq, isNotNull, not, sql } from "drizzle-orm";
import type { Transaction } from "../../platform/database/types.js";
import { issue } from "./access.js";
import { eligibleAssigneePredicate } from "./assignees.js";
import { issueConflict } from "./errors.js";

type CleanupScope = {
  organisationId: string;
  teamId?: string;
  userId?: string;
};

// Called inside the existing exclusive organisation transaction. Never acquire another barrier here.
export async function clearIssueAssignments(
  tx: Transaction,
  actorId: string,
  scope: CleanupScope,
  cause: IssueCleanupCause,
) {
  const departing =
    cause === "organisation_member_removed" ||
    cause === "organisation_member_left";
  const predicate = and(
    eq(issue.organisationId, scope.organisationId),
    isNotNull(issue.assigneeId),
    scope.teamId ? eq(issue.teamId, scope.teamId) : undefined,
    scope.userId ? eq(issue.assigneeId, scope.userId) : undefined,
    departing
      ? undefined
      : not(
          eligibleAssigneePredicate(
            issue.organisationId,
            issue.teamId,
            issue.assigneeId,
          ),
        ),
  );
  // Lock in a stable order; the returned rows feed history in the same statement, including archived issues.
  // The global version guard ensures no subset is cleared if any affected issue has exhausted its version.
  const result = await tx.execute<{ exhausted: boolean }>(sql`
    with candidates as materialized (
      select ${issue.id}, ${issue.version}, ${issue.assigneeId}, ${authSchema.user.name} as assignee_name
      from ${issue} inner join ${authSchema.user} on ${authSchema.user.id} = ${issue.assigneeId}
      where ${predicate} order by ${issue.id} for update of ${issue}
    ), changed as (
      update ${issue} set assignee_id = null, version = ${issue.version} + 1, updated_at = clock_timestamp()
      from candidates c where ${issue.id} = c.id
        and not exists (select 1 from candidates where version = 2147483647)
      returning ${issue.id}, ${issue.organisationId}, ${issue.version}, c.assignee_id, c.assignee_name
    ), recorded as (
      insert into issue_activity (organisation_id, issue_id, issue_version, actor_id, actor_name, kind, cause, changes)
      select organisation_id, id, version, ${actorId}::uuid,
        (select name from auth_user where id = ${actorId}::uuid), 'assignment_cleared', ${cause},
        jsonb_build_object('assignee', jsonb_build_object('from',
          jsonb_build_object('id', assignee_id, 'name', assignee_name), 'to', null))
      from changed returning id
    )
    select exists(select 1 from candidates where version = 2147483647) as exhausted,
      (select count(*) from recorded) as recorded
  `);
  if (result.rows[0]!.exhausted)
    throw issueConflict("Issue version limit reached");
}
