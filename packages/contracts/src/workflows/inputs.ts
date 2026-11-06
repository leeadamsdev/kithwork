import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { organisationPageInputSchema } from "../organisations/schema.js";
import { teamInputSchema } from "../teams/inputs.js";
import { maxActiveWorkflowStatuses, workflowCategorySchema } from "./schema.js";

export const workflowInputSchema = teamInputSchema;
export const versionedWorkflowInputSchema = workflowInputSchema.extend({
  expectedWorkflowVersion: z.number().int().positive().max(2147483647),
});
const name = z.string().trim().min(1).max(50);
const description = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null)
  .nullable();
export const createWorkflowStatusInputSchema =
  versionedWorkflowInputSchema.extend({
    name,
    description: description.default(null),
    category: workflowCategorySchema,
  });
export type CreateWorkflowStatusInput = z.infer<
  typeof createWorkflowStatusInputSchema
>;
export const workflowStatusInputSchema = versionedWorkflowInputSchema.extend({
  statusId: entityIdSchema,
});
export type WorkflowStatusInput = z.infer<typeof workflowStatusInputSchema>;
export const updateWorkflowStatusInputSchema = workflowStatusInputSchema
  .extend({ name: name.optional(), description: description.optional() })
  .refine(
    (input) => input.name !== undefined || input.description !== undefined,
    "Provide a status update",
  );
export type UpdateWorkflowStatusInput = z.infer<
  typeof updateWorkflowStatusInputSchema
>;
export const reorderWorkflowStatusesInputSchema =
  versionedWorkflowInputSchema.extend({
    category: workflowCategorySchema,
    statusIds: z
      .array(z.string().toLowerCase().pipe(entityIdSchema))
      .min(1)
      .max(maxActiveWorkflowStatuses)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Status IDs must be distinct",
      ),
  });
export type ReorderWorkflowStatusesInput = z.infer<
  typeof reorderWorkflowStatusesInputSchema
>;
export const workflowStatusPageInputSchema = workflowInputSchema.extend({
  ...organisationPageInputSchema.shape,
  retired: z.enum(["exclude", "include", "only"]).default("exclude"),
});
export type WorkflowStatusPageInput = z.infer<
  typeof workflowStatusPageInputSchema
>;
