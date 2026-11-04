import { z } from "zod";

export const emailMessageMaxLengths = {
  to: 254,
  url: 4096,
  organisationName: 100,
} as const;

const fields = {
  to: z.email().max(emailMessageMaxLengths.to),
  url: z.url({ protocol: /^https?$/ }).max(emailMessageMaxLengths.url),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
};
export const emailMessageSchema = z.discriminatedUnion("kind", [
  z.object({ ...fields, kind: z.literal("verification") }),
  z.object({ ...fields, kind: z.literal("password-reset") }),
  z.object({
    ...fields,
    kind: z.literal("invitation"),
    organisationName: z
      .string()
      .trim()
      .min(1)
      .max(emailMessageMaxLengths.organisationName),
  }),
]);
export type EmailMessage = z.infer<typeof emailMessageSchema>;

export const emailQueueName = "email";
export const emailQueuePrefix = "kithwork";
