import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { parseEncryptionKey } from "../crypto.js";
import { createEmailMaintenance, scrubFailedEmail } from "./maintenance.js";
import { emailQueueName, emailQueuePrefix } from "../message.js";
import { createEmailProcessor } from "./processor.js";
import type { EmailWorkerOptions } from "./options.js";
export type { EmailWorkerOptions } from "./options.js";
export { createSmtpDelivery } from "../delivery/smtp.js";
export type { OutboxDeliveryOutcome } from "./outbox-reference.js";

export async function createEmailWorker(options: EmailWorkerOptions) {
  const key = parseEncryptionKey(options.encryptionKey);
  const redis = new Redis(options.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectTimeout: 1500,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
  });
  redis.on("error", () => options.onEvent({ event: "error" }));
  try {
    await redis.connect();
  } catch {
    redis.disconnect();
    throw new Error("Email worker could not start");
  }
  const worker = new Worker<unknown>(
    emailQueueName,
    createEmailProcessor(options, key),
    {
      connection: redis,
      prefix: options.prefix ?? emailQueuePrefix,
      concurrency: options.concurrency,
      autorun: false,
    },
  );
  worker.on("error", () => options.onEvent({ event: "error" }));
  const pendingCleanup = new Set<Promise<void>>();
  worker.on("failed", (job) => {
    if (!job) return;
    // Stalled-job failures can bypass the application processor entirely.
    const task = scrubFailedEmail(job)
      .catch(() => options.onEvent({ event: "error" }))
      .finally(() => {
        pendingCleanup.delete(task);
      });
    pendingCleanup.add(task);
  });
  let closing: Promise<void> | undefined;
  try {
    await worker.waitUntilReady();
  } catch {
    await worker.close(true);
    redis.disconnect();
    throw new Error("Email worker could not start");
  }
  const queue = new Queue<unknown>(emailQueueName, {
    connection: redis,
    prefix: options.prefix ?? emailQueuePrefix,
  });
  queue.on("error", () => options.onEvent({ event: "error" }));
  const maintenance = createEmailMaintenance(
    queue,
    redis,
    options.maintenanceIntervalMs ?? 60000,
    () => options.onEvent({ event: "error" }),
  );
  const finished = worker.run();
  void finished.catch(() => options.onEvent({ event: "error" }));
  return {
    finished,
    close() {
      closing ??= (async () => {
        try {
          await Promise.all([worker.close(), maintenance.stop()]);
          await Promise.all(pendingCleanup);
        } finally {
          try {
            await queue.close();
          } finally {
            redis.disconnect();
          }
        }
      })();
      return closing;
    },
  };
}
