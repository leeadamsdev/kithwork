import { randomBytes, randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterEach, expect, it } from "vitest";
import { createEmailProducer } from "@kithwork/email";
import { createEmailWorker } from "@kithwork/email/worker";
import { integrationServices } from "../../context.js";
import { uniqueNamespace } from "../../support/namespace.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const options = {
    redisUrl: integrationServices().redisUrl,
    encryptionKey: randomBytes(32).toString("base64"),
    prefix: uniqueNamespace(),
  };
  const queue = new Queue<unknown>("email", {
    connection: { url: options.redisUrl },
    prefix: options.prefix,
  });
  cleanups.push(async () => {
    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  });
  const producer = await createEmailProducer({ ...options, onError: () => {} });
  cleanups.push(() => producer.close());
  return { options, queue, producer };
}

it("delivers an outbox reference without embedding recipient or bearer data", async () => {
  const { options, queue, producer } = await fixture();
  const id = randomUUID(),
    requestId = randomUUID(),
    expiresAt = Date.now() + 60_000;
  const deliveries: string[] = [];
  const events: string[] = [];
  const worker = await createEmailWorker({
    ...options,
    concurrency: 1,
    deliver: () => {
      throw new Error("Legacy delivery must not run");
    },
    deliverOutboxEmail: (outboxId) => {
      deliveries.push(outboxId);
      return Promise.resolve("delivered");
    },
    onEvent: (event) => events.push(event.event),
  });
  cleanups.push(() => worker.close());
  await producer.ensureOutboxEmail({ id, requestId, expiresAt });
  await expect
    .poll(async () => (await queue.getJob(id))?.getState())
    .toBe("completed");
  expect(deliveries).toEqual([id]);
  expect((await queue.getJob(id))?.data).toEqual({
    outboxId: id,
    expiresAt,
    requestId,
  });
  expect(events).toContain("delivered");
});

it("retains safe failed references for reconciliation and reports skipped deliveries accurately", async () => {
  const { options, queue, producer } = await fixture();
  const id = randomUUID(),
    expiresAt = Date.now() + 60_000;
  await producer.ensureOutboxEmail({ id, expiresAt });
  const events: string[] = [];
  let outcome: "failed" | "skipped" = "failed";
  const worker = await createEmailWorker({
    ...options,
    concurrency: 1,
    maintenanceIntervalMs: 10,
    deliver: () => Promise.resolve(),
    deliverOutboxEmail: () => Promise.resolve(outcome),
    onEvent: (event) => events.push(event.event),
  });
  cleanups.push(() => worker.close());
  await expect
    .poll(async () => (await queue.getJob(id))?.getState())
    .toBe("failed");
  expect((await queue.getJob(id))?.data).toEqual({ outboxId: id, expiresAt });
  outcome = "skipped";
  await producer.ensureOutboxEmail({ id, expiresAt });
  await expect
    .poll(async () => (await queue.getJob(id))?.getState())
    .toBe("completed");
  expect(events).toContain("skipped");
  expect(events).not.toContain("delivered");
});
it("removes expired reference jobs from a paused queue without invoking delivery", async () => {
  const { options, queue, producer } = await fixture();
  await queue.pause();
  const id = randomUUID();
  await producer.ensureOutboxEmail({ id, expiresAt: Date.now() - 1000 });
  const worker = await createEmailWorker({
    ...options,
    concurrency: 1,
    maintenanceIntervalMs: 10,
    deliver: () => {
      throw new Error("Must not deliver expired mail");
    },
    deliverOutboxEmail: () => {
      throw new Error("Must not process expired reference");
    },
    onEvent: () => {},
  });
  cleanups.push(() => worker.close());
  await expect.poll(() => queue.getJob(id)).toBeUndefined();
});
