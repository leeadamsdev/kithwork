import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { connect, createServer, type Socket } from "node:net";
import { Queue } from "bullmq";
import { describe, expect, it } from "vitest";
import { createEmailProducer } from "@kithwork/email";
import { integrationServices } from "../../context.js";
import { uniqueNamespace } from "../../support/namespace.js";
import { cleanups } from "./fixtures.js";
describe("email admission", () => {
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
});
