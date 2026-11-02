import { z } from "zod";

export const entityIdSchema = z.uuid().brand<"EntityId">();

export type EntityId = z.infer<typeof entityIdSchema>;
