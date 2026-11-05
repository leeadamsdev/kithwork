import { z } from "zod";

export const outboxReferenceSchema = z.strictObject({
  outboxId: z.uuid(),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  requestId: z.uuid().optional(),
});
export type OutboxEmailReference = z.infer<typeof outboxReferenceSchema>;
export type OutboxDeliveryOutcome = "delivered" | "skipped" | "failed";
