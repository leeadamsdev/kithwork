import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { teamVisibilitySchema } from "../teams/schema.js";

export const projectStatuses = [
  "planned",
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;
export const projectStatusSchema = z.enum(projectStatuses);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export const projectDateSchema = z.iso
  .date()
  .refine(
    (value) => !value.startsWith("0000-"),
    "Planning dates require a year from 0001 to 9999",
  );
export const projectSchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: projectStatusSchema,
  startDate: projectDateSchema.nullable(),
  targetDate: projectDateSchema.nullable(),
  version: z.number().int().positive().max(2147483647),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  capabilities: z.strictObject({
    canEdit: z.boolean(),
    canManageTeams: z.boolean(),
    canArchive: z.boolean(),
    canRestore: z.boolean(),
  }),
});
export type Project = z.infer<typeof projectSchema>;
export const projectTeamSchema = z.strictObject({
  id: entityIdSchema,
  name: z.string(),
  key: z.string(),
  visibility: teamVisibilitySchema,
  archivedAt: z.iso.datetime().nullable(),
});
export type ProjectTeam = z.infer<typeof projectTeamSchema>;
export const projectDetailSchema = projectSchema.extend({
  teams: z.array(projectTeamSchema),
});
export const projectPageSchema = z.strictObject({
  items: z.array(projectSchema),
  nextCursor: entityIdSchema.nullable(),
});
