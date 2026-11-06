import {
  encodeIssueCursor,
  type IssueCommentListInput,
} from "@kithwork/contracts";
import { and, eq, gt, or } from "drizzle-orm";
import type { Database } from "../../../platform/database/types.js";
import { teamReadPredicate } from "../../teams/access.js";
import { readIssueAccess } from "../access.js";
import {
  issueComment,
  readCommentAccess,
  selectCommentAccess,
  type CommentScope,
} from "./access.js";
import { presentComment } from "./presentation.js";

export async function getComment(
  db: Database,
  actorId: string,
  input: CommentScope,
) {
  const row = await readCommentAccess(db, actorId, input);
  return presentComment(row.comment, row, actorId);
}
export async function listComments(
  db: Database,
  actorId: string,
  input: IssueCommentListInput,
) {
  await readIssueAccess(db, actorId, input);
  const rows = await selectCommentAccess(db, actorId)
    .where(
      and(
        eq(issueComment.organisationId, input.organisationId),
        eq(issueComment.issueId, input.issueId),
        teamReadPredicate(),
        input.cursor
          ? or(
              gt(issueComment.createdAt, new Date(input.cursor.createdAt)),
              and(
                eq(issueComment.createdAt, new Date(input.cursor.createdAt)),
                gt(issueComment.id, input.cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(issueComment.createdAt, issueComment.id)
    .limit(input.limit + 1);
  const items = rows
    .slice(0, input.limit)
    .map((row) => presentComment(row.comment, row, actorId));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > input.limit && last
        ? encodeIssueCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}
