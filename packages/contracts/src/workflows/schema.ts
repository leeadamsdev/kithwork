import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";

export const workflowCategories = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
export const workflowCategorySchema = z.enum(workflowCategories);
export type WorkflowCategory = z.infer<typeof workflowCategorySchema>;
export const maxActiveWorkflowStatuses = 50;
export const workflowStatusSchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  teamId: entityIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: workflowCategorySchema,
  position: z.number().int().nonnegative(),
  isDefault: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  retiredAt: z.iso.datetime().nullable(),
});
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export const workflowSchema = z.strictObject({
  organisationId: entityIdSchema,
  teamId: entityIdSchema,
  version: z.number().int().positive().max(2147483647),
  statuses: z.array(workflowStatusSchema).max(maxActiveWorkflowStatuses),
  capabilities: z.strictObject({ canManage: z.boolean() }),
});
export type Workflow = z.infer<typeof workflowSchema>;
export const workflowStatusPageSchema = z.strictObject({
  version: z.number().int().positive().max(2147483647),
  items: z.array(workflowStatusSchema),
  nextCursor: entityIdSchema.nullable(),
});
export type WorkflowStatusPage = z.infer<typeof workflowStatusPageSchema>;
