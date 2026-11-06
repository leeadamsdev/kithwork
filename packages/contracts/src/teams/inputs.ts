import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { textInputSchema } from "../primitives/text-input.js";
import {
  organisationInputSchema,
  organisationPageInputSchema,
} from "../organisations/schema.js";
import { teamRoleSchema, teamVisibilitySchema } from "./schema.js";

const name = textInputSchema.trim().min(1).max(100);
const description = textInputSchema
  .trim()
  .max(2000)
  .transform((value) => value || null)
  .nullable();
export const teamInputSchema = organisationInputSchema.extend({
  teamId: entityIdSchema,
});
export const versionedTeamInputSchema = teamInputSchema.extend({
  expectedVersion: z.number().int().positive().max(2147483647),
});
export const createTeamInputSchema = organisationInputSchema.extend({
  name,
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/),
  description: description.default(null),
  visibility: teamVisibilitySchema.default("organisation"),
});
export type CreateTeamInput = z.infer<typeof createTeamInputSchema>;
export const updateTeamInputSchema = versionedTeamInputSchema
  .extend({ name: name.optional(), description: description.optional() })
  .refine(
    (input) => input.name !== undefined || input.description !== undefined,
    "Provide a team update",
  );
export type UpdateTeamInput = z.infer<typeof updateTeamInputSchema>;
export const setTeamVisibilityInputSchema = versionedTeamInputSchema.extend({
  visibility: teamVisibilitySchema,
});
export const teamPageInputSchema = organisationInputSchema.extend({
  ...organisationPageInputSchema.shape,
  scope: z.enum(["all", "mine"]).default("all"),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
});
export type TeamPageInput = z.infer<typeof teamPageInputSchema>;
export const teamMemberPageInputSchema = teamInputSchema.extend(
  organisationPageInputSchema.shape,
);
export const teamMemberInputSchema = teamInputSchema.extend({
  userId: entityIdSchema,
});
export const addTeamMemberInputSchema = teamMemberInputSchema.extend({
  role: teamRoleSchema.default("member"),
});
export const changeTeamMemberRoleInputSchema = teamMemberInputSchema.extend({
  role: teamRoleSchema,
});
