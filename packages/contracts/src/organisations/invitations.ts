import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";
import { organisationPageInputSchema } from "./schema.js";

export const invitationRoles = ["member", "admin"] as const;
export const invitationRoleSchema = z.enum(invitationRoles);
export type InvitationRole = z.infer<typeof invitationRoleSchema>;
export const invitationStatuses = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;
export const invitationStatusSchema = z.enum(invitationStatuses);
export const invitationEmailStatusSchema = z.enum([
  "pending",
  "sent",
  "skipped",
  "failed",
]);
export const createInvitationInputSchema = z.strictObject({
  organisationId: entityIdSchema,
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: invitationRoleSchema,
});
export const invitationInputSchema = z.strictObject({
  organisationId: entityIdSchema,
  invitationId: entityIdSchema,
});
export const invitationPreviewInputSchema = z.strictObject({
  invitationId: entityIdSchema,
});
export const acceptInvitationInputSchema = invitationPreviewInputSchema.extend({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const invitationPageInputSchema = organisationPageInputSchema.extend({
  organisationId: entityIdSchema,
});
export const invitationSchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  email: z.email(),
  role: invitationRoleSchema,
  issuerId: entityIdSchema,
  status: invitationStatusSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  resendAvailableAt: z.iso.datetime(),
  emailStatus: invitationEmailStatusSchema,
});
export const invitationPageSchema = z.strictObject({
  items: z.array(invitationSchema),
  nextCursor: entityIdSchema.nullable(),
});
export const invitationPreviewSchema = z.strictObject({
  id: entityIdSchema,
  organisationId: entityIdSchema,
  organisationName: z.string(),
  role: invitationRoleSchema,
  expiresAt: z.iso.datetime(),
});
