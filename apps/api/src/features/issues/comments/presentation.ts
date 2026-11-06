import type { CommentRow } from "./access.js";
import {
  canEditComment,
  canDeleteComment,
  type CommentContext,
} from "./policies.js";

export function presentComment(
  comment: CommentRow,
  access: CommentContext,
  actorId: string,
) {
  return {
    id: comment.id,
    organisationId: comment.organisationId,
    issueId: comment.issueId,
    author: { id: comment.authorId, name: comment.authorName },
    body: comment.body,
    version: comment.version,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    editedAt: comment.editedAt?.toISOString() ?? null,
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    capabilities: {
      canEdit:
        !comment.deletedAt &&
        !access.issue.archivedAt &&
        !access.team.archivedAt &&
        canEditComment(comment, actorId),
      canDelete:
        !comment.deletedAt && canDeleteComment(comment, access, actorId),
    },
  };
}
