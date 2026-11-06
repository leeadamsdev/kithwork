import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { calendarDateSchema } from "../primitives/calendar-date.js";
import { issuePrioritySchema, issueUserSchema } from "./schema.js";
import { workflowCategorySchema } from "../workflows/schema.js";

export const issueActivityKinds = [
  "created",
  "updated",
  "archived",
  "restored",
  "assignment_cleared",
] as const;
export const issueActivityKindSchema = z.enum(issueActivityKinds);
export type IssueActivityKind = z.infer<typeof issueActivityKindSchema>;
export const issueActivityCauses = [
  "user",
  "organisation_member_removed",
  "organisation_member_left",
  "team_member_removed",
  "team_member_left",
  "team_visibility_changed",
  "organisation_role_changed",
] as const;
export const issueActivityCauseSchema = z.enum(issueActivityCauses);
export type IssueCleanupCause = Exclude<
  z.infer<typeof issueActivityCauseSchema>,
  "user"
>;
const statusSnapshot = z.strictObject({
  id: entityIdSchema,
  name: z.string(),
  category: workflowCategorySchema,
});
export type IssueStatusSnapshot = z.infer<typeof statusSnapshot>;
const baseChangesSchema = z.strictObject({
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
  assignee: z
    .strictObject({
      from: issueUserSchema.nullable(),
      to: issueUserSchema.nullable(),
    })
    .optional(),
});
export const issueProjectReferenceSchema = z.discriminatedUnion("available", [
  z.strictObject({
    available: z.literal(true),
    id: entityIdSchema,
    name: z.string(),
  }),
  z.strictObject({ available: z.literal(false) }),
]);
export const issueStoredChangesSchema = baseChangesSchema.extend({
  project: z
    .strictObject({
      from: entityIdSchema.nullable(),
      to: entityIdSchema.nullable(),
    })
    .optional(),
});
export const issueChangesSchema = baseChangesSchema.extend({
  project: z
    .strictObject({
      from: issueProjectReferenceSchema.nullable(),
      to: issueProjectReferenceSchema.nullable(),
    })
    .optional(),
});
export type IssueChanges = z.infer<typeof issueChangesSchema>;
export type IssueChangeValues = z.input<typeof issueStoredChangesSchema>;
export const issueActivitySchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  issueId: entityIdSchema,
  issueVersion: z.number().int().positive().max(2147483647),
  kind: issueActivityKindSchema,
  cause: issueActivityCauseSchema,
  actor: z.strictObject({ id: entityIdSchema.nullable(), name: z.string() }),
  createdAt: z.iso.datetime(),
  changes: issueChangesSchema,
});
export const issueActivityPageSchema = z.strictObject({
  items: z.array(issueActivitySchema),
  nextCursor: z.number().int().positive().nullable(),
});
export type IssueActivityPage = z.infer<typeof issueActivityPageSchema>;
