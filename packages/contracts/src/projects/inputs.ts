import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import {
  organisationInputSchema,
  organisationPageInputSchema,
} from "../organisations/schema.js";
import { projectDateSchema, projectStatusSchema } from "./schema.js";

const name = z.string().trim().min(1).max(100);
const description = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => value || null)
  .nullable();
const date = projectDateSchema.nullable();
const teamIds = z
  .array(z.string().toLowerCase().pipe(entityIdSchema))
  .min(1)
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Team IDs must be distinct",
  );
export const projectInputSchema = organisationInputSchema.extend({
  projectId: entityIdSchema,
});
export const versionedProjectInputSchema = projectInputSchema.extend({
  expectedVersion: z.number().int().positive().max(2147483647),
});
export type VersionedProjectInput = z.infer<typeof versionedProjectInputSchema>;
export const createProjectInputSchema = organisationInputSchema
  .extend({
    name,
    description: description.default(null),
    status: projectStatusSchema.default("planned"),
    startDate: date.default(null),
    targetDate: date.default(null),
    teamIds,
  })
  .refine(
    (input) =>
      !input.startDate ||
      !input.targetDate ||
      input.targetDate >= input.startDate,
    "Target date must not precede start date",
  );
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export const updateProjectInputSchema = versionedProjectInputSchema
  .extend({
    name: name.optional(),
    description: description.optional(),
    status: projectStatusSchema.optional(),
    startDate: date.optional(),
    targetDate: date.optional(),
  })
  .refine(
    (input) =>
      [
        input.name,
        input.description,
        input.status,
        input.startDate,
        input.targetDate,
      ].some((value) => value !== undefined),
    "Provide a project update",
  );
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export const setProjectTeamsInputSchema = versionedProjectInputSchema.extend({
  teamIds,
});
export type SetProjectTeamsInput = z.infer<typeof setProjectTeamsInputSchema>;
export const projectPageInputSchema = organisationInputSchema.extend({
  ...organisationPageInputSchema.shape,
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
  status: projectStatusSchema.optional(),
  teamId: entityIdSchema.optional(),
});
export type ProjectPageInput = z.infer<typeof projectPageInputSchema>;
