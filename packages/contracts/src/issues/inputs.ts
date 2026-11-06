import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { calendarDateSchema } from "../primitives/calendar-date.js";
import { organisationInputSchema } from "../organisations/schema.js";
import { workflowCategorySchema } from "../workflows/schema.js";
import { encodedIssueCursorSchema, issuePrioritySchema } from "./schema.js";

const title = z.string().trim().min(1).max(200);
const description = z
  .string()
  .max(20000)
  .transform((value) => (value.trim() ? value : null))
  .nullable();
export const issueInputSchema = organisationInputSchema.extend({
  issueId: entityIdSchema,
});
export const versionedIssueInputSchema = issueInputSchema.extend({
  expectedVersion: z.number().int().positive().max(2147483647),
});
export type VersionedIssueInput = z.infer<typeof versionedIssueInputSchema>;
export const createIssueInputSchema = organisationInputSchema.extend({
  teamId: entityIdSchema,
  title,
  description: description.default(null),
  statusId: entityIdSchema.optional(),
  priority: issuePrioritySchema.default("none"),
  dueDate: calendarDateSchema.nullable().default(null),
});
export type CreateIssueInput = z.infer<typeof createIssueInputSchema>;
export const updateIssueInputSchema = versionedIssueInputSchema
  .extend({
    title: title.optional(),
    description: description.optional(),
    statusId: entityIdSchema.optional(),
    priority: issuePrioritySchema.optional(),
    dueDate: calendarDateSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      [
        input.title,
        input.description,
        input.statusId,
        input.priority,
        input.dueDate,
      ].some((value) => value !== undefined),
    "Provide an issue update",
  );
export type UpdateIssueInput = z.infer<typeof updateIssueInputSchema>;
export const restoreIssueInputSchema = versionedIssueInputSchema.extend({
  statusId: entityIdSchema.optional(),
});
export const issueIdentifierInputSchema = organisationInputSchema.extend({
  identifier: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,9}$/)
    .refine(
      (value) => Number(value.split("-")[1]) <= 2147483647,
      "Issue number limit exceeded",
    ),
});
export const issueListInputSchema = organisationInputSchema.extend({
  teamId: entityIdSchema.optional(),
  statusId: entityIdSchema.optional(),
  category: workflowCategorySchema.optional(),
  priority: issuePrioritySchema.optional(),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
  includeArchivedTeams: z.boolean().default(false),
  cursor: encodedIssueCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type IssueListInput = z.infer<typeof issueListInputSchema>;
export const issueActivityPageInputSchema = issueInputSchema.extend({
  cursor: z.number().int().positive().max(2147483647).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type IssueActivityPageInput = z.infer<
  typeof issueActivityPageInputSchema
>;
