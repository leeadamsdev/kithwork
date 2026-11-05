import type { EmailMessage } from "../message.js";
import type { OutboxDeliveryOutcome } from "./outbox-reference.js";
export interface EmailWorkerOptions {
  redisUrl: string;
  encryptionKey: string;
  prefix?: string;
  concurrency: number;
  maintenanceIntervalMs?: number;
  deliver: (message: EmailMessage, id: string) => Promise<void>;
  deliverOutboxEmail?: (outboxId: string) => Promise<OutboxDeliveryOutcome>;
  onEvent: (event: {
    event: "delivered" | "skipped" | "expired" | "failed" | "error";
    jobId?: string;
    requestId?: string;
    attempt?: number;
  }) => void;
}
