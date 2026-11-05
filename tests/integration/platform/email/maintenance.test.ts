import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { integrationServices } from "../../context.js";
import { fixture, cleanups } from "./fixtures.js";
describe("email maintenance", () => {
  it("cleans expired paused jobs and old terminal metadata while the queue is idle", async () => {
    const { producer, queue } = await fixture(() => Promise.resolve(), 50);
    const message = {
      kind: "verification" as const,
      to: "expiry@example.test",
      url: "https://example.test/verify",
      expiresAt: Date.now() + 60000,
    };
    const completed = randomUUID();
    await producer.enqueue(message, { id: completed });
    await expect
      .poll(async () => (await queue.getJob(completed))?.getState())
      .toBe("completed");
    const client = new Redis(integrationServices().redisUrl);
    cleanups.push(() => client.quit());
    await client.hset(
      queue.toKey(completed),
      "finishedOn",
      String(Date.now() - 2 * 86400000),
    );
    await client.zadd(
      queue.toKey("completed"),
      Date.now() - 2 * 86400000,
      completed,
    );
    await expect
      .poll(async () => Boolean(await queue.getJob(completed)), {
        timeout: 2000,
      })
      .toBe(false);
    await queue.pause();
    const expired = randomUUID();
    await producer.enqueue(
      { ...message, expiresAt: Date.now() + 100 },
      { id: expired },
    );
    await expect
      .poll(async () => Boolean(await queue.getJob(expired)), { timeout: 2000 })
      .toBe(false);
  });
  it("scrubs payloads when BullMQ fails a deferred stalled job without invoking the processor", async () => {
    let delivered = false;
    const { producer, queue } = await fixture(() => {
      delivered = true;
      return Promise.resolve();
    }, 50);
    await queue.pause();
    const id = randomUUID();
    await producer.enqueue(
      {
        kind: "verification",
        to: "stalled@example.test",
        url: "https://example.test/verify?token=private-stalled",
        expiresAt: Date.now() + 60000,
      },
      { id },
    );
    const client = new Redis(integrationServices().redisUrl);
    cleanups.push(() => client.quit());
    await client.hset(
      queue.toKey(id),
      "defa",
      "job stalled more than allowable limit",
    );
    await queue.resume();
    await expect
      .poll(async () => (await queue.getJob(id))?.getState())
      .toBe("failed");
    await expect
      .poll(async () => (await queue.getJob(id))?.data, { timeout: 2000 })
      .toEqual({});
    expect(delivered).toBe(false);
  });
});
