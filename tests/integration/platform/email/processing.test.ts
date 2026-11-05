import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures.js";
describe("email processing", () => {
  it("does not retry permanent SMTP rejection and expires delayed messages before sending", async () => {
    let deliveries = 0;
    const { producer, queue } = await fixture(() => {
      deliveries++;
      return Promise.reject(
        Object.assign(new Error("private rejection"), {
          responseCode: 550,
        }),
      );
    });
    const id = randomUUID();
    const message = {
      kind: "verification" as const,
      to: "reject@example.test",
      url: "https://example.test/verify",
      expiresAt: Date.now() + 60000,
    };
    await producer.enqueue(message, { id });
    await expect
      .poll(async () => (await queue.getJob(id))?.getState())
      .toBe("failed");
    expect(deliveries).toBe(1);
    expect((await queue.getJob(id))?.data).toEqual({});
    // A paused queue models a delivery backlog that outlives the link.
    await queue.pause();
    const expired = randomUUID();
    await producer.enqueue(
      { ...message, expiresAt: Date.now() + 500 },
      { id: expired },
    );
    await expect
      .poll(() => Date.now(), { interval: 50 })
      .toBeGreaterThan((await queue.getJob(expired))!.timestamp + 500);
    await queue.resume();
    await expect
      .poll(async () => (await queue.getJob(expired))?.getState())
      .toBe("completed");
    expect(deliveries).toBe(1);
    expect((await queue.getJob(expired))?.data).toEqual({});
  });
  it("persists encrypted data, delivers once and clears the completed payload", async () => {
    const received = Promise.withResolvers<unknown>();
    const { producer, queue } = await fixture((message, id) => {
      received.resolve({ message, id });
      return Promise.resolve();
    });
    const id = randomUUID();
    const message = {
      kind: "verification" as const,
      to: "queue@example.test",
      url: "https://example.test/verify?token=private-link",
      expiresAt: Date.now() + 60000,
    };
    await producer.enqueue(message, { id });
    expect(await received.promise).toEqual({ message, id });
    await expect
      .poll(async () => (await queue.getJob(id))?.getState())
      .toBe("completed");
    expect((await queue.getJob(id))?.data).toEqual({});
    await producer.enqueue(message, { id });
    expect(await queue.getCompletedCount()).toBe(1);
  });
  it("retries transient failures and scrubs terminal errors without leaking SMTP data", async () => {
    let attempts = 0;
    const { producer, queue } = await fixture(() => {
      attempts++;
      return Promise.reject(new Error("private-smtp-error token=private-link"));
    });
    const id = randomUUID();
    await producer.enqueue(
      {
        kind: "password-reset",
        to: "retry@example.test",
        url: "https://example.test/reset?token=private-link",
        expiresAt: Date.now() + 60000,
      },
      { id },
    );
    await expect
      .poll(async () => (await queue.getJob(id))?.getState(), {
        timeout: 20000,
      })
      .toBe("failed");
    const job = await queue.getJob(id);
    expect(attempts).toBe(5);
    expect(job?.data).toEqual({});
    expect(JSON.stringify(job?.toJSON())).not.toContain("private-link");
    expect(job?.failedReason).toBe("Email delivery failed");
  }, 25000);
  it("rejects expired messages before enqueue and waits for active delivery during shutdown", async () => {
    const active = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { producer, worker } = await fixture(async () => {
      active.resolve();
      await release.promise;
    });
    const message = {
      kind: "verification" as const,
      to: "close@example.test",
      url: "https://example.test/verify",
      expiresAt: Date.now() + 60000,
    };
    await expect(
      producer.enqueue({ ...message, expiresAt: Date.now() - 1 }),
    ).rejects.toThrow("Email has expired");
    await producer.enqueue(message);
    await active.promise;
    let closed = false;
    const closing = worker.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    release.resolve();
    await closing;
  });
});
