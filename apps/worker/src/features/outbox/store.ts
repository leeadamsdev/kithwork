import type { createDatabase } from "@kithwork/database";
import { createPublicationStore } from "./publication.js";
import { createDeliveryStore } from "./delivery-store.js";
import { maintainOutbox } from "./maintenance.js";

export function createOutboxStore(db: ReturnType<typeof createDatabase>["db"]) {
  return {
    ...createPublicationStore(db),
    ...createDeliveryStore(db),
    maintain: () => maintainOutbox(db),
  };
}
