import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sealMessage, parseEncryptionKey } from "../crypto.js";
import { outboxReferenceSchema } from "./outbox-reference.js";
import {
  emailMessageSchema,
  emailQueueName,
  emailQueuePrefix,
  type EmailMessage,
} from "../message.js";
export type { EmailMessage } from "../message.js";

export interface EmailQueueOptions {
  redisUrl: string;
  encryptionKey: string;
  prefix?: string;
  onError: () => void;
}
export async function createEmailProducer(options: EmailQueueOptions) {
  const key = parseEncryptionKey(options.encryptionKey);
  const redis = new Redis(options.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    commandTimeout: 2000,
    autoResendUnfulfilledCommands: false,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
  });
  redis.on("error", () => options.onError());
  let queue: Queue<unknown>;
  try {
    await redis.connect();
    queue = new Queue(emailQueueName, {
      connection: redis,
      prefix: options.prefix ?? emailQueuePrefix,
      skipWaitingForReady: true,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 86400, count: 1000 },
      },
    });
    queue.on("error", () => options.onError());
    await queue.waitUntilReady();
  } catch {
    redis.disconnect();
    throw new Error("Email queue unavailable");
  }
  let closing: Promise<void> | undefined;
  return {
    async ensureOutboxEmail(
      this: void,
      {
        id,
        expiresAt,
        requestId,
      }: {
        id: string;
        expiresAt: number;
        requestId?: string;
      },
    ) {
      const parsed = outboxReferenceSchema.safeParse({
        outboxId: id,
        expiresAt,
        ...(requestId ? { requestId } : {}),
      });
      if (!parsed.success) throw new Error("Invalid outbox reference");
      if (closing || redis.status !== "ready")
        throw new Error("Email queue unavailable");
      try {
        const job = await queue.getJob(id);
        if (!job) {
          await queue.add("deliver-outbox", parsed.data, { jobId: id });
          return;
        }
        const state = await job.getState();
        if (state === "failed" || state === "completed") {
          await job.updateData(parsed.data);
          await job.retry(state, {
            resetAttemptsMade: true,
            resetAttemptsStarted: true,
          });
        }
      } catch {
        throw new Error("Email queue unavailable");
      }
    },
    async enqueue(
      value: EmailMessage,
      {
        id = randomUUID(),
        requestId,
      }: { id?: string; requestId?: string } = {},
    ) {
      const parsed = emailMessageSchema.safeParse(value);
      if (
        !parsed.success ||
        !z.uuid().safeParse(id).success ||
        (requestId !== undefined && !z.uuid().safeParse(requestId).success)
      )
        throw new Error("Invalid email message");
      if (parsed.data.expiresAt <= Date.now())
        throw new Error("Email has expired");
      if (closing || redis.status !== "ready")
        throw new Error("Email queue unavailable");
      try {
        await queue.add(
          "deliver",
          {
            sealed: sealMessage(parsed.data, key),
            ...(requestId ? { requestId } : {}),
          },
          { jobId: id },
        );
      } catch {
        throw new Error("Email queue unavailable");
      }
      return id;
    },
    close() {
      closing ??= (async () => {
        try {
          await queue.close();
        } finally {
          redis.disconnect();
        }
      })();
      return closing;
    },
  };
}
