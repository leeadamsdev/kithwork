import {
  createIssueCommentInputSchema,
  updateIssueCommentInputSchema,
  deleteIssueCommentInputSchema,
  issueCommentInputSchema,
  issueCommentListInputSchema,
  issueCommentSchema,
  issueCommentPageSchema,
} from "@kithwork/contracts";
import { router } from "../../../platform/trpc/procedures.js";
import { organisationProcedure } from "../../organisations/procedure.js";
import { requireActiveTeam } from "../../teams/transaction.js";
import { readIssueAccess } from "../access.js";
import { requireActiveIssue } from "../transaction.js";
import { issueForbidden } from "../errors.js";
import { createComment, updateComment, deleteComment } from "./commands.js";
import { getComment, listComments } from "./queries.js";
import { readCommentAccess } from "./access.js";
import { canEditComment } from "./policies.js";

export const commentsRouter = router({
  create: organisationProcedure
    .input(createIssueCommentInputSchema)
    .output(issueCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const access = await readIssueAccess(ctx.db, ctx.user.id, input);
      requireActiveTeam(access.team);
      requireActiveIssue(access.issue);
      await ctx.consumeCommentCreationLimit(ctx.user.id, input.organisationId);
      const result = await createComment(
        ctx.db,
        { ...ctx.user, requestId: ctx.requestId },
        input,
      );
      ctx.log.info(
        {
          action: "comment.created",
          issueId: result.issueId,
          commentId: result.id,
          commentVersion: result.version,
        },
        "Comment changed",
      );
      return result;
    }),
  get: organisationProcedure
    .input(issueCommentInputSchema)
    .output(issueCommentSchema)
    .query(({ ctx, input }) => getComment(ctx.db, ctx.user.id, input)),
  list: organisationProcedure
    .input(issueCommentListInputSchema)
    .output(issueCommentPageSchema)
    .query(({ ctx, input }) => listComments(ctx.db, ctx.user.id, input)),
  update: organisationProcedure
    .input(updateIssueCommentInputSchema)
    .output(issueCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const access = await readCommentAccess(ctx.db, ctx.user.id, input);
      if (!canEditComment(access.comment, ctx.user.id)) throw issueForbidden();
      requireActiveTeam(access.team);
      requireActiveIssue(access.issue);
      await ctx.consumeCommentEditLimit(ctx.user.id);
      const result = await updateComment(
        ctx.db,
        { ...ctx.user, requestId: ctx.requestId },
        input,
      );
      ctx.log.info(
        {
          action: "comment.updated",
          issueId: result.issueId,
          commentId: result.id,
          commentVersion: result.version,
        },
        "Comment changed",
      );
      return result;
    }),
  delete: organisationProcedure
    .input(deleteIssueCommentInputSchema)
    .output(issueCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await deleteComment(
        ctx.db,
        { ...ctx.user, requestId: ctx.requestId },
        input,
      );
      ctx.log.info(
        {
          action: "comment.deleted",
          issueId: result.issueId,
          commentId: result.id,
          commentVersion: result.version,
        },
        "Comment changed",
      );
      return result;
    }),
});
