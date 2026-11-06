import { canManageTeam } from "../../teams/policies.js";
import type { CommentAccess, CommentRow } from "./access.js";

export type CommentContext = Omit<CommentAccess, "comment">;
export const canEditComment = (comment: CommentRow, actorId: string) =>
  comment.authorId === actorId;
export const canDeleteComment = (
  comment: CommentRow,
  access: CommentContext,
  actorId: string,
) =>
  canEditComment(comment, actorId) ||
  canManageTeam(access.organisationRole, access.membershipRole);
