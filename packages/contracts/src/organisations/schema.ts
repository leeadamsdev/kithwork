import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { textInputSchema } from "../primitives/text-input.js";

export const organisationRoles = ["owner", "admin", "member"] as const;
export const organisationRoleSchema = z.enum(organisationRoles);
export type OrganisationRole = z.infer<typeof organisationRoleSchema>;

const name = textInputSchema.trim().min(1).max(100);
export const createOrganisationInputSchema = z.strictObject({ name });
export const organisationInputSchema = z.strictObject({
  organisationId: entityIdSchema,
});
export const updateOrganisationInputSchema = organisationInputSchema.extend({
  name,
});
export const organisationPageInputSchema = z.strictObject({
  cursor: entityIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const memberPageInputSchema = organisationInputSchema.extend(
  organisationPageInputSchema.shape,
);
export const memberInputSchema = organisationInputSchema.extend({
  userId: entityIdSchema,
});
export const changeMemberRoleInputSchema = memberInputSchema.extend({
  role: organisationRoleSchema,
});

export const organisationSchema = z.strictObject({
  id: entityIdSchema,
  name: z.string(),
  role: organisationRoleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const organisationMemberSchema = z.strictObject({
  userId: entityIdSchema,
  name: z.string(),
  role: organisationRoleSchema,
  joinedAt: z.iso.datetime(),
});
export const organisationPageSchema = z.strictObject({
  items: z.array(organisationSchema),
  nextCursor: entityIdSchema.nullable(),
});
export const memberPageSchema = z.strictObject({
  items: z.array(organisationMemberSchema),
  nextCursor: entityIdSchema.nullable(),
});
