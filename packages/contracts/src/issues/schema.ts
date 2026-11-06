import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { calendarDateSchema } from "../primitives/calendar-date.js";
import { workflowCategorySchema } from "../workflows/schema.js";

export const issuePriorities = [
  "none",
  "urgent",
  "high",
  "normal",
  "low",
] as const;
export const issuePrioritySchema = z.enum(issuePriorities);
export type IssuePriority = z.infer<typeof issuePrioritySchema>;
export const issueStatusSchema = z.strictObject({
  id: entityIdSchema,
  name: z.string(),
  category: workflowCategorySchema,
  retiredAt: z.iso.datetime().nullable(),
});
export const issueSummarySchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  teamId: entityIdSchema,
  number: z.number().int().positive().max(2147483647),
  identifier: z.string(),
  title: z.string(),
  statusId: entityIdSchema,
  status: issueStatusSchema,
  priority: issuePrioritySchema,
  dueDate: calendarDateSchema.nullable(),
  version: z.number().int().positive().max(2147483647),
  creatorId: entityIdSchema.nullable(),
  creator: z.strictObject({ id: entityIdSchema, name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  capabilities: z.strictObject({
    canEdit: z.boolean(),
    canArchive: z.boolean(),
    canRestore: z.boolean(),
  }),
});
export type IssueSummary = z.infer<typeof issueSummarySchema>;
export const issueDetailSchema = issueSummarySchema.extend({
  description: z.string().nullable(),
});
export type IssueDetail = z.infer<typeof issueDetailSchema>;
export const issuePageSchema = z.strictObject({
  items: z.array(issueSummarySchema),
  nextCursor: z.string().nullable(),
});

export const issueCursorSchema = z.strictObject({
  createdAt: z.iso
    .datetime({ precision: 3 })
    .refine((value) => !value.startsWith("0000-")),
  id: entityIdSchema,
});
export type IssueCursor = z.infer<typeof issueCursorSchema>;
export function encodeIssueCursor(
  cursor: z.input<typeof issueCursorSchema>,
): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export const encodedIssueCursorSchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)
  .transform((value, ctx) => {
    try {
      const decoded: unknown = JSON.parse(
        atob(value.replaceAll("-", "+").replaceAll("_", "/")),
      );
      const result = issueCursorSchema.safeParse(decoded);
      if (result.success) return result.data;
    } catch {
      /* Malformed cursors are untrusted input. */
    }
    ctx.addIssue({ code: "custom", message: "Invalid issue cursor" });
    return z.NEVER;
  });
