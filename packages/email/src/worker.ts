import { Queue, Worker, UnrecoverableError, type Job } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { openMessage, parseEncryptionKey } from "./crypto.js";
import { createEmailMaintenance, scrubFailedEmail } from "./maintenance.js";
import {
  emailQueueName,
  emailQueuePrefix,
  type EmailMessage,
} from "./message.js";

export { createSmtpDelivery } from "./smtp.js";
export interface EmailWorkerOptions {
  redisUrl: string;
  encryptionKey: string;
  prefix?: string;
  concurrency: number;
  maintenanceIntervalMs?: number;
  deliver: (message: EmailMessage, id: string) => Promise<void>;
  onEvent: (event: {
    event: "delivered" | "expired" | "failed" | "error";
    jobId?: string;
    requestId?: string;
    attempt?: number;
  }) => void;
}
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
    async (job: Job<unknown>) => {
      const envelope = z
        .object({ sealed: z.unknown(), requestId: z.uuid().optional() })
        .safeParse(job.data);
      const fields = {
        jobId: job.id!,
        attempt: job.attemptsMade + 1,
        ...(envelope.success && envelope.data.requestId
          ? { requestId: envelope.data.requestId }
          : {}),
      };
      let message: EmailMessage;
      try {
        if (!envelope.success) throw new Error("Invalid envelope");
        message = openMessage(envelope.data.sealed, key);
      } catch {
        await job.updateData({});
        throw new UnrecoverableError("Invalid email payload");
      }
      if (message.expiresAt <= Date.now()) {
        await job.updateData({});
        options.onEvent({ event: "expired", ...fields });
        return;
      }
      // Classify failures without retaining SMTP error objects, which may contain links or credentials.
      const failure = await options.deliver(message, job.id!).then(
        () => undefined,
        (error: unknown) => {
          // A permanently rejected SMTP recipient will not succeed on retry.
          const permanent =
            error instanceof Error &&
            "responseCode" in error &&
            typeof error.responseCode === "number" &&
            error.responseCode >= 500 &&
            error.responseCode <= 599;
          return { permanent };
        },
      );
      if (failure) {
        if (
          failure.permanent ||
          job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
        )
          await job.updateData({});
        options.onEvent({ event: "failed", ...fields });
        if (failure.permanent)
          throw new UnrecoverableError("Email delivery rejected");
        throw new Error("Email delivery failed");
      }
      // Retain only non-sensitive completion metadata for bounded deduplication.
      await job.updateData({});
      options.onEvent({ event: "delivered", ...fields });
    },
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
