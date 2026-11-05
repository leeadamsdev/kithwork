import { randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import { afterEach } from "vitest";
import { createEmailProducer } from "@kithwork/email";
import { createEmailWorker } from "@kithwork/email/worker";
import { integrationServices } from "../../context.js";
import { uniqueNamespace } from "../../support/namespace.js";
export const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const close of cleanups.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Email test cleanup failed");
});
export async function fixture(
  deliver: Parameters<typeof createEmailWorker>[0]["deliver"],
  maintenanceIntervalMs?: number,
) {
  const { redisUrl } = integrationServices();
  const encryptionKey = randomBytes(32).toString("base64");
  const prefix = uniqueNamespace();
  const queue = new Queue<unknown>("email", {
    connection: { url: redisUrl },
    prefix,
  });
  cleanups.push(async () => {
    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  });
  const producer = await createEmailProducer({
    redisUrl,
    encryptionKey,
    prefix,
    onError: () => {},
  });
  cleanups.push(() => producer.close());
  const worker = await createEmailWorker({
    redisUrl,
    encryptionKey,
    prefix,
    deliver,
    concurrency: 2,
    ...(maintenanceIntervalMs === undefined ? {} : { maintenanceIntervalMs }),
    onEvent: () => {},
  });
  cleanups.push(() => worker.close());
  return { producer, worker, queue };
}
