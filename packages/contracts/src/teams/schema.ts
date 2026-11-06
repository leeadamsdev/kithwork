import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";

export const teamRoles = ["maintainer", "member"] as const;
export const teamRoleSchema = z.enum(teamRoles);
export type TeamRole = z.infer<typeof teamRoleSchema>;
export const teamVisibilities = ["organisation", "private"] as const;
export const teamVisibilitySchema = z.enum(teamVisibilities);
export type TeamVisibility = z.infer<typeof teamVisibilitySchema>;

export const teamSchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  name: z.string(),
  key: z.string(),
  description: z.string().nullable(),
  visibility: teamVisibilitySchema,
  version: z.number().int().positive().max(2147483647),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  membershipRole: teamRoleSchema.nullable(),
  capabilities: z.strictObject({
    canEdit: z.boolean(),
    canChangeVisibility: z.boolean(),
    canArchive: z.boolean(),
    canRestore: z.boolean(),
    canAddMembers: z.boolean(),
    canChangeRoles: z.boolean(),
    canRemoveMembers: z.boolean(),
    canJoin: z.boolean(),
    canLeave: z.boolean(),
  }),
});
export type Team = z.infer<typeof teamSchema>;
export const teamPageSchema = z.strictObject({
  items: z.array(teamSchema),
  nextCursor: entityIdSchema.nullable(),
});
export const teamMemberSchema = z.strictObject({
  userId: entityIdSchema,
  name: z.string(),
  role: teamRoleSchema,
  joinedAt: z.iso.datetime(),
});
export const teamMemberPageSchema = z.strictObject({
  items: z.array(teamMemberSchema),
  nextCursor: entityIdSchema.nullable(),
});
