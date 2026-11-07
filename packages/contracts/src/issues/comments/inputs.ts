import { z } from "zod";
import { entityIdSchema } from "../../identifiers.js";
import { textInputSchema } from "../../primitives/text-input.js";
import { issueInputSchema } from "../inputs.js";
import { encodedIssueCursorSchema } from "../schema.js";
import { teamInputSchema } from "../../teams/inputs.js";
import { organisationPageInputSchema } from "../../organisations/schema.js";

const body = textInputSchema
  .min(1)
  .max(20000)
  .refine((value) => value.trim().length > 0, "Comment must contain text");
export const issueCommentInputSchema = issueInputSchema.extend({
  commentId: entityIdSchema,
});
export const createIssueCommentInputSchema = issueInputSchema.extend({
  creationKey: entityIdSchema,
  body,
});
export type CreateIssueCommentInput = z.infer<
  typeof createIssueCommentInputSchema
>;
export const deleteIssueCommentInputSchema = issueCommentInputSchema.extend({
  expectedVersion: z.number().int().positive().max(2147483647),
});
export type DeleteIssueCommentInput = z.infer<
  typeof deleteIssueCommentInputSchema
>;
export const updateIssueCommentInputSchema =
  deleteIssueCommentInputSchema.extend({ body });
export type UpdateIssueCommentInput = z.infer<
  typeof updateIssueCommentInputSchema
>;
export const issueCommentListInputSchema = issueInputSchema.extend({
  cursor: encodedIssueCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type IssueCommentListInput = z.infer<typeof issueCommentListInputSchema>;
export const issueMentionTargetsInputSchema = teamInputSchema.extend({
  ...organisationPageInputSchema.shape,
  prefix: textInputSchema.trim().max(100).optional(),
});
export type IssueMentionTargetsInput = z.infer<
  typeof issueMentionTargetsInputSchema
>;
