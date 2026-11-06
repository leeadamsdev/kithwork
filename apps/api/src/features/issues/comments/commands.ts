import { createHash } from "node:crypto";
import type {
  CreateIssueCommentInput,
  UpdateIssueCommentInput,
  DeleteIssueCommentInput,
} from "@kithwork/contracts";
import { and, eq, lt, sql } from "drizzle-orm";
import type {
  Database,
  Transaction,
} from "../../../platform/database/types.js";
import { requireActiveTeam } from "../../teams/transaction.js";
import { requireActiveIssue, withLockedIssue } from "../transaction.js";
import { issueConflict, issueForbidden } from "../errors.js";
import {
  issueComment,
  commentScope,
  lockComment,
  type CommentRow,
} from "./access.js";
import { appendCommentEvent, type CommentActor } from "./events.js";
import { canEditComment, canDeleteComment } from "./policies.js";
import { presentComment } from "./presentation.js";

export function createComment(
  db: Database,
  actor: CommentActor,
  input: CreateIssueCommentInput,
) {
  return withLockedIssue(db, actor.id, input, async (tx, access) => {
    requireActiveTeam(access.team);
    requireActiveIssue(access.issue);
    const hash = createHash("sha256").update(input.body, "utf8").digest("hex");
    const [existing] = await tx
      .select()
      .from(issueComment)
      .where(
        and(
          eq(issueComment.organisationId, input.organisationId),
          eq(issueComment.issueId, input.issueId),
          eq(issueComment.authorId, actor.id),
          eq(issueComment.creationKey, input.creationKey),
        ),
      );
    if (existing) {
      if (existing.creationHash !== hash)
        throw issueConflict("Creation key already used for another comment");
      return presentComment(existing, access, actor.id);
    }
    const [row] = await tx
      .insert(issueComment)
      .values({
        organisationId: input.organisationId,
        issueId: input.issueId,
        authorId: actor.id,
        authorName: actor.name,
        body: input.body,
        creationKey: input.creationKey,
        creationHash: hash,
      })
      .returning();
    await appendCommentEvent(tx, actor, row!, "created");
    return presentComment(row!, access, actor.id);
  });
}
function requireVersion(row: CommentRow, expected: number) {
  if (row.version !== expected)
    throw issueConflict("Comment has changed; refresh and retry");
}
async function saveComment(
  tx: Transaction,
  row: CommentRow,
  values: Partial<Pick<CommentRow, "body" | "editedAt" | "deletedAt">>,
) {
  const [updated] = await tx
    .update(issueComment)
    .set({
      ...values,
      version: sql`${issueComment.version}+1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        commentScope({
          organisationId: row.organisationId,
          issueId: row.issueId,
          commentId: row.id,
        }),
        lt(issueComment.version, 2147483647),
      ),
    )
    .returning();
  if (!updated) throw issueConflict("Comment version limit reached");
  return updated;
}
export function updateComment(
  db: Database,
  actor: CommentActor,
  input: UpdateIssueCommentInput,
) {
  return withLockedIssue(db, actor.id, input, async (tx, access) => {
    const row = await lockComment(tx, input);
    if (!canEditComment(row, actor.id)) throw issueForbidden();
    requireActiveTeam(access.team);
    requireActiveIssue(access.issue);
    if (row.deletedAt) throw issueConflict("Comment has been deleted");
    requireVersion(row, input.expectedVersion);
    if (row.body === input.body) return presentComment(row, access, actor.id);
    const updated = await saveComment(tx, row, {
      body: input.body,
      editedAt: new Date(),
    });
    await appendCommentEvent(tx, actor, updated, "edited");
    return presentComment(updated, access, actor.id);
  });
}
export function deleteComment(
  db: Database,
  actor: CommentActor,
  input: DeleteIssueCommentInput,
) {
  return withLockedIssue(db, actor.id, input, async (tx, access) => {
    const row = await lockComment(tx, input);
    if (!canDeleteComment(row, access, actor.id)) throw issueForbidden();
    // Deletion remains available on archived targets, but only with current access and authority.
    if (row.deletedAt) return presentComment(row, access, actor.id);
    requireVersion(row, input.expectedVersion);
    const updated = await saveComment(tx, row, {
      body: null,
      deletedAt: new Date(),
    });
    await appendCommentEvent(tx, actor, updated, "deleted");
    return presentComment(updated, access, actor.id);
  });
}
