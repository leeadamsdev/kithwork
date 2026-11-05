import { z } from "zod";
export const systemInfoSchema = z.object({
  name: z.literal("kithwork-api"),
  version: z.string().min(1),
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;
