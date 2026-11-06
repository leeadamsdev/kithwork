import type { IssueCommentEventKind } from "@kithwork/contracts";
import { commentEventsSchema } from "@kithwork/database";
import type { Transaction } from "../../../platform/database/types.js";
import type { IssueActor } from "../activity.js";
import type { CommentRow } from "./access.js";

export type CommentActor = IssueActor & { requestId: string };
export async function appendCommentEvent(
  tx: Transaction,
  actor: CommentActor,
  comment: CommentRow,
  kind: IssueCommentEventKind,
) {
  await tx.insert(commentEventsSchema.issueCommentEvent).values({
    organisationId: comment.organisationId,
    issueId: comment.issueId,
    commentId: comment.id,
    commentVersion: comment.version,
    kind,
    actorId: actor.id,
    actorName: actor.name,
    requestId: actor.requestId,
  });
}
