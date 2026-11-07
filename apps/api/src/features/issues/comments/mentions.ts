import {
  commentMentionIdsSchema,
  inspectCommentMentionLinks,
} from "@kithwork/contracts";
import { authSchema, commentMentionsSchema } from "@kithwork/database";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Transaction } from "../../../platform/database/types.js";
import { eligibleIssueParticipantPredicate } from "../audience.js";
import { issueUnavailable } from "../errors.js";
import { commentScope, issueComment, type CommentRow } from "./access.js";
const { issueCommentMention } = commentMentionsSchema;

export async function syncCommentMentions(
  tx: Transaction,
  teamId: string,
  before: CommentRow | null,
  current: CommentRow,
) {
  const parsed = commentMentionIdsSchema.safeParse(current.body);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.issues[0]!.message,
    });
  const ids = parsed.data;
  const scope = {
    organisationId: current.organisationId,
    issueId: current.issueId,
    commentId: current.id,
  };
  const where = and(
    eq(issueCommentMention.organisationId, scope.organisationId),
    eq(issueCommentMention.issueId, scope.issueId),
    eq(issueCommentMention.commentId, scope.commentId),
  );
  const existing = await tx.select().from(issueCommentMention).where(where);
  const previousActive = new Set(
    before?.mentionsInitialised
      ? existing.filter((row) => row.active).map((row) => row.userId)
      : [],
  );
  const introduced = ids.filter((id) => !previousActive.has(id));
  if (introduced.length) {
    const eligible = await tx
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(
        and(
          inArray(authSchema.user.id, introduced),
          eligibleIssueParticipantPredicate(
            current.organisationId,
            teamId,
            authSchema.user.id,
          ),
        ),
      );
    if (eligible.length !== introduced.length) throw issueUnavailable();
  }
  const oldLinks = new Set(
    before && !before.mentionsInitialised
      ? inspectCommentMentionLinks(before.body ?? "").userIds
      : [],
  );
  const known = new Set(existing.map((row) => row.userId));
  await tx.update(issueCommentMention).set({ active: false }).where(where);
  if (ids.length)
    await tx
      .insert(issueCommentMention)
      .values(
        ids.map((userId) => ({
          ...scope,
          userId,
          firstMentionedVersion: oldLinks.has(userId)
            ? before!.version
            : current.version,
          active: true,
        })),
      )
      .onConflictDoUpdate({
        target: [
          issueCommentMention.organisationId,
          issueCommentMention.issueId,
          issueCommentMention.commentId,
          issueCommentMention.userId,
        ],
        set: { active: true },
      });
  if (!current.mentionsInitialised)
    await tx
      .update(issueComment)
      .set({ mentionsInitialised: true })
      .where(commentScope(scope));
  return {
    firstMentionUserIds: ids.filter(
      (id) => !known.has(id) && !oldLinks.has(id),
    ),
  };
}

export async function clearCommentMentions(tx: Transaction, row: CommentRow) {
  await tx
    .delete(issueCommentMention)
    .where(
      and(
        eq(issueCommentMention.organisationId, row.organisationId),
        eq(issueCommentMention.issueId, row.issueId),
        eq(issueCommentMention.commentId, row.id),
      ),
    );
}
