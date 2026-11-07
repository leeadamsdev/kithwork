import { authSchema, commentMentionsSchema } from "@kithwork/database";
import { and, eq, exists, inArray, isNull } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import { teamReadPredicate } from "../../teams/access.js";
import type { IssueScope } from "../access.js";
import { issueComment, selectCommentAccess } from "./access.js";
const { issueCommentMention } = commentMentionsSchema;

export async function readCommentMentions(
  db: Database | Transaction,
  actorId: string,
  scope: IssueScope,
  commentIds: string[],
) {
  const grouped = new Map<string, { id: string; name: string }[]>();
  if (!commentIds.length) return grouped;
  const rows = await db
    .select({
      commentId: issueCommentMention.commentId,
      id: authSchema.user.id,
      name: authSchema.user.name,
    })
    .from(issueCommentMention)
    .innerJoin(
      authSchema.user,
      eq(authSchema.user.id, issueCommentMention.userId),
    )
    .where(
      and(
        eq(issueCommentMention.organisationId, scope.organisationId),
        eq(issueCommentMention.issueId, scope.issueId),
        inArray(issueCommentMention.commentId, commentIds),
        eq(issueCommentMention.active, true),
        exists(
          selectCommentAccess(db, actorId).where(
            and(
              eq(issueComment.organisationId, scope.organisationId),
              eq(issueComment.issueId, scope.issueId),
              eq(issueComment.id, issueCommentMention.commentId),
              isNull(issueComment.deletedAt),
              teamReadPredicate(),
            ),
          ),
        ),
      ),
    )
    .orderBy(issueCommentMention.userId);
  for (const row of rows) {
    const mentions = grouped.get(row.commentId) ?? [];
    mentions.push({ id: row.id, name: row.name });
    grouped.set(row.commentId, mentions);
  }
  return grouped;
}
