import { commentsSchema } from "@kithwork/database";
import { and, eq } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import {
  actorTeamMember,
  organisationMember,
  team,
  teamReadPredicate,
} from "../../teams/access.js";
import { issue, type IssueScope } from "../access.js";
import { issueUnavailable } from "../errors.js";

export const { issueComment } = commentsSchema;
export type CommentRow = typeof issueComment.$inferSelect;
export type CommentScope = IssueScope & { commentId: string };
export const commentScope = (input: CommentScope) =>
  and(
    eq(issueComment.organisationId, input.organisationId),
    eq(issueComment.issueId, input.issueId),
    eq(issueComment.id, input.commentId),
  );

export function selectCommentAccess(
  db: Database | Transaction,
  actorId: string,
) {
  return db
    .select({
      comment: issueComment,
      issue: { archivedAt: issue.archivedAt },
      team: { archivedAt: team.archivedAt },
      organisationRole: organisationMember.role,
      membershipRole: actorTeamMember.role,
    })
    .from(issueComment)
    .innerJoin(
      issue,
      and(
        eq(issue.organisationId, issueComment.organisationId),
        eq(issue.id, issueComment.issueId),
      ),
    )
    .innerJoin(
      team,
      and(
        eq(team.organisationId, issue.organisationId),
        eq(team.id, issue.teamId),
      ),
    )
    .innerJoin(
      organisationMember,
      and(
        eq(organisationMember.organisationId, issue.organisationId),
        eq(organisationMember.userId, actorId),
      ),
    )
    .leftJoin(
      actorTeamMember,
      and(
        eq(actorTeamMember.organisationId, team.organisationId),
        eq(actorTeamMember.teamId, team.id),
        eq(actorTeamMember.userId, actorId),
      ),
    );
}
export type CommentAccess = Awaited<
  ReturnType<typeof selectCommentAccess>
>[number];
export async function readCommentAccess(
  db: Database | Transaction,
  actorId: string,
  input: CommentScope,
) {
  const [row] = await selectCommentAccess(db, actorId).where(
    and(commentScope(input), teamReadPredicate()),
  );
  if (!row) throw issueUnavailable();
  return row;
}
export async function lockComment(tx: Transaction, input: CommentScope) {
  const [row] = await tx
    .select()
    .from(issueComment)
    .where(commentScope(input))
    .for("update");
  if (!row) throw issueUnavailable();
  return row;
}
