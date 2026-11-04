import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { connect, createServer, type Socket } from "node:net";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import { createEmailProducer } from "@kithwork/email";
import { createEmailWorker, createSmtpDelivery } from "@kithwork/email/worker";
import { integrationServices } from "./context.js";
import { uniqueNamespace } from "./fixtures.js";

const cleanups: (() => Promise<unknown> | void)[] = [];
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

async function fixture(
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

describe("queued email", () => {
  it("does not forward authentication errors or credentials through error callbacks", async () => {
    const url = new URL(integrationServices().redisUrl);
    url.password = "private-bad-auth-marker";
    const received: unknown[][] = [];
    await expect(
      createEmailProducer({
        redisUrl: url.toString(),
        encryptionKey: randomBytes(32).toString("base64"),
        onError: (...args: unknown[]) => {
          received.push(args);
        },
      }),
    ).rejects.toThrow("Email queue unavailable");
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((args) => args.length === 0)).toBe(true);
  });
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
  it("fails queue admission promptly during Redis outage and recovers without buffering rejected mail", async () => {
    const upstream = new URL(integrationServices().redisUrl);
    const sockets = new Set<Socket>();
    const proxy = createServer((socket) => {
      const target = connect(Number(upstream.port), upstream.hostname);
      for (const connection of [socket, target]) {
        sockets.add(connection);
        connection.on("close", () => sockets.delete(connection));
        connection.on("error", () => {
          socket.destroy();
          target.destroy();
        });
      }
      socket.pipe(target).pipe(socket);
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const address = proxy.address();
    if (!address || typeof address === "string")
      throw new Error("Missing proxy address");
    const closeProxy = () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        proxy.close(() => resolve());
      });
    const prefix = uniqueNamespace();
    const queue = new Queue<unknown>("email", {
      connection: { url: upstream.toString() },
      prefix,
    });
    cleanups.push(async () => {
      try {
        await queue.obliterate();
      } finally {
        await queue.close();
      }
    });
    const url = new URL(upstream);
    url.hostname = "127.0.0.1";
    url.port = String(address.port);
    const producer = await createEmailProducer({
      redisUrl: url.toString(),
      encryptionKey: randomBytes(32).toString("base64"),
      prefix,
      onError: () => {},
    });
    const message = {
      kind: "verification" as const,
      to: "outage@example.test",
      url: "https://example.test/verify?token=private-outage-token",
      expiresAt: Date.now() + 60000,
    };
    try {
      await producer.enqueue(message);
      const stored = await queue.getWaiting();
      expect(JSON.stringify(stored.map((job) => job.data))).not.toMatch(
        /private-outage-token|outage@example/,
      );
      await closeProxy();
      const start = Date.now();
      await expect(producer.enqueue(message)).rejects.toThrow(
        "Email queue unavailable",
      );
      expect(Date.now() - start).toBeLessThan(2500);
      proxy.listen(address.port, "127.0.0.1");
      await once(proxy, "listening");
      const id = randomUUID();
      await expect
        .poll(() => producer.enqueue(message, { id }), { timeout: 5000 })
        .toBe(id);
      expect(await queue.getWaitingCount()).toBe(2);
    } finally {
      await producer.close();
      await closeProxy();
    }
  });
  it("delivers real SMTP messages with HTML, text and stable identity to Mailpit", async () => {
    const services = integrationServices();
    const smtp = createSmtpDelivery({
      host: services.smtpHost,
      port: services.smtpPort,
      secure: false,
      requireTLS: false,
      from: "Kithwork <no-reply@kithwork.test>",
    });
    cleanups.push(smtp.close);
    const { producer, queue } = await fixture(smtp.deliver);
    for (const kind of [
      "verification",
      "password-reset",
      "invitation",
    ] as const) {
      const id = randomUUID();
      const to = `${id}@example.test`;
      const url = `https://example.test/action?token=${id}`;
      const common = { to, url, expiresAt: Date.now() + 60000 };
      await producer.enqueue(
        kind === "invitation"
          ? { ...common, kind, organisationName: "Software team" }
          : { ...common, kind },
        { id },
      );
      let found: { messages: { ID: string }[] } = { messages: [] };
      await expect
        .poll(async () => {
          const response = await fetch(
            `${services.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
          );
          expect(response.ok).toBe(true);
          found = (await response.json()) as typeof found;
          return found.messages.length;
        })
        .toBe(1);
      const response = await fetch(
        `${services.mailpitUrl}/api/v1/message/${found.messages[0]!.ID}`,
      );
      const email = (await response.json()) as {
        HTML: string;
        Text: string;
        MessageID: string;
      };
      expect(email.Text).toContain(url);
      expect(email.HTML).toContain(id);
      expect(email.MessageID).toContain(id);
      await expect
        .poll(async () => (await queue.getJob(id))?.getState())
        .toBe("completed");
    }
  });
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
