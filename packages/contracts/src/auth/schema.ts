import { z } from "zod";
import { entityIdSchema } from "../identifiers.js";

export const authenticatedUserSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  email: z.email(),
  emailVerified: z.literal(true),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
