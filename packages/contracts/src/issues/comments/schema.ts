import { z } from "zod";
import { entityIdSchema } from "../../identifiers.js";

export const issueCommentEventKinds = ["created", "edited", "deleted"] as const;
export type IssueCommentEventKind = (typeof issueCommentEventKinds)[number];
export const issueMentionTargetSchema = z.strictObject({
  id: entityIdSchema,
  name: z.string(),
});
export const issueMentionTargetPageSchema = z.strictObject({
  items: z.array(issueMentionTargetSchema),
  nextCursor: entityIdSchema.nullable(),
});
export const issueCommentSchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  issueId: entityIdSchema,
  author: z.strictObject({ id: entityIdSchema.nullable(), name: z.string() }),
  body: z.string().nullable(),
  mentions: z.array(issueMentionTargetSchema).max(20),
  version: z.number().int().positive().max(2147483647),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  capabilities: z.strictObject({
    canEdit: z.boolean(),
    canDelete: z.boolean(),
  }),
});
export type IssueComment = z.infer<typeof issueCommentSchema>;
export const issueCommentPageSchema = z.strictObject({
  items: z.array(issueCommentSchema),
  nextCursor: z.string().nullable(),
});
export type IssueCommentPage = z.infer<typeof issueCommentPageSchema>;
