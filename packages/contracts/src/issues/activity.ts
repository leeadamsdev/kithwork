import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { calendarDateSchema } from "../primitives/calendar-date.js";
import { issuePrioritySchema } from "./schema.js";
import { workflowCategorySchema } from "../workflows/schema.js";

export const issueActivityKinds = [
  "created",
  "updated",
  "archived",
  "restored",
] as const;
export const issueActivityKindSchema = z.enum(issueActivityKinds);
export type IssueActivityKind = z.infer<typeof issueActivityKindSchema>;
const statusSnapshot = z.strictObject({
  id: entityIdSchema,
  name: z.string(),
  category: workflowCategorySchema,
});
export type IssueStatusSnapshot = z.infer<typeof statusSnapshot>;
export const issueChangesSchema = z.strictObject({
  title: z
    .strictObject({ from: z.string().nullable(), to: z.string() })
    .optional(),
  description: z.strictObject({ changed: z.literal(true) }).optional(),
  status: z
    .strictObject({ from: statusSnapshot.nullable(), to: statusSnapshot })
    .optional(),
  priority: z
    .strictObject({
      from: issuePrioritySchema.nullable(),
      to: issuePrioritySchema,
    })
    .optional(),
  dueDate: z
    .strictObject({
      from: calendarDateSchema.nullable(),
      to: calendarDateSchema.nullable(),
    })
    .optional(),
  archivedAt: z
    .strictObject({
      from: z.iso.datetime().nullable(),
      to: z.iso.datetime().nullable(),
    })
    .optional(),
});
export type IssueChanges = z.infer<typeof issueChangesSchema>;
export type IssueChangeValues = z.input<typeof issueChangesSchema>;
export const issueActivitySchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  issueId: entityIdSchema,
  issueVersion: z.number().int().positive().max(2147483647),
  kind: issueActivityKindSchema,
  cause: z.literal("user"),
  actor: z.strictObject({ id: entityIdSchema.nullable(), name: z.string() }),
  createdAt: z.iso.datetime(),
  changes: issueChangesSchema,
});
export const issueActivityPageSchema = z.strictObject({
  items: z.array(issueActivitySchema),
  nextCursor: z.number().int().positive().nullable(),
});
export type IssueActivityPage = z.infer<typeof issueActivityPageSchema>;
