import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { createApi } from "../../src/app.js";
import { createLogger } from "../../src/logger.js";
import { parseConfig } from "../../src/config.js";
import { runApi } from "../../src/runtime.js";
import {
  createTestDatabase,
  uniqueNamespace,
} from "../../../../tests/integration/fixtures.js";
import { integrationServices } from "../../../../tests/integration/context.js";
import { startApiProcess } from "../fixtures/process.js";
import { Writable } from "node:stream";
import { createServer, connect } from "node:net";
import type { Socket } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "@kithwork/database";

describe("API lifecycle", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.close();
  });
  const env = () => ({
    DATABASE_URL: database.connectionString,
    REDIS_URL: integrationServices().redisUrl,
    API_PORT: "0",
    API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
  });

  it("cleans up a failed startup and permits explicit factory closure", async () => {
    const app = createApi({
      config: parseConfig({ ...env(), REDIS_URL: "redis://127.0.0.1:1" }),
      logger: createLogger("silent"),
    });
    try {
      await expect(app.ready()).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
  it("does not log credentials when real Redis authentication fails", async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const url = new URL(integrationServices().redisUrl);
    const password = `private-${randomUUID()}`;
    url.password = password;
    const app = createApi({
      config: parseConfig({ ...env(), REDIS_URL: url.toString() }),
      logger: createLogger("error", destination),
    });
    try {
      await expect(app.ready()).rejects.toThrow();
    } finally {
      await app.close();
    }
    expect(lines.join("\n")).toContain("WRONGPASS");
    expect(lines.join("\n")).not.toContain(password);
  });
  it("recovers after a Redis outage without queuing or permitting requests during failure", async () => {
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
      throw new Error("Missing Redis proxy");
    const url = new URL(upstream);
    url.hostname = "127.0.0.1";
    url.port = String(address.port);
    const app = createApi({
      config: parseConfig({ ...env(), REDIS_URL: url.toString() }),
      logger: createLogger("silent"),
    });
    const closeProxy = () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        proxy.close(() => resolve());
      });
    try {
      await app.ready();
      await closeProxy();
      expect((await app.inject("/health/ready")).statusCode).toBe(503);
      expect((await app.inject("/trpc/system.info")).statusCode).toBe(500);
      await delay(2000);
      proxy.listen(address.port, "127.0.0.1");
      await once(proxy, "listening");
      await expect
        .poll(async () => (await app.inject("/health/ready")).statusCode, {
          timeout: 5000,
        })
        .toBe(200);
      expect((await app.inject("/trpc/system.info")).statusCode).toBe(200);
    } finally {
      await app.close();
      await closeProxy();
    }
  }, 15000);
  it("keeps liveness available and refuses rate-limited traffic when Redis fails", async () => {
    const admin = new Redis(integrationServices().redisUrl);
    const user = uniqueNamespace();
    const password = randomUUID();
    const url = new URL(integrationServices().redisUrl);
    url.username = user;
    url.password = password;
    await admin.acl("SETUSER", user, "on", `>${password}`, "~*", "+@all");
    const app = createApi({
      config: parseConfig({ ...env(), REDIS_URL: url.toString() }),
      logger: createLogger("silent"),
    });
    try {
      await app.ready();
      await admin.acl("SETUSER", user, "-@all");
      expect((await app.inject("/health/live")).statusCode).toBe(200);
      expect((await app.inject("/health/ready")).statusCode).toBe(503);
      const failed = await app.inject("/trpc/system.info");
      expect(failed.statusCode).toBe(500);
      expect(failed.body).not.toMatch(/NOPERM|password|Redis/);
      await admin.acl("SETUSER", user, "+@all");
      expect((await app.inject("/health/ready")).statusCode).toBe(200);
    } finally {
      await admin.acl("SETUSER", user, "+@all");
      await app.close();
      await admin.acl("DELUSER", user);
      await admin.quit();
    }
  });
  it("starts the compiled entrypoint and serves real requests", async () => {
    const child = await startApiProcess(env());
    try {
      expect((await fetch(`${child.address}/health/ready`)).status).toBe(200);
      expect((await fetch(`${child.address}/trpc/system.info`)).status).toBe(
        200,
      );
    } finally {
      await child.stop();
    }
    expect(child.stderr()).toBe("");
  });
  it("reports database failure independently of liveness and recovers", async () => {
    const admin = createDatabase({
      connectionString: integrationServices().postgresUrl,
      onPoolError: (error) => {
        throw error;
      },
    });
    const app = createApi({
      config: parseConfig(env()),
      logger: createLogger("silent"),
    });
    const name = new URL(database.connectionString).pathname.slice(1);
    try {
      await app.ready();
      await admin.pool.query(
        `ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`,
      );
      await admin.pool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
        [name],
      );
      expect((await app.inject("/health/live")).statusCode).toBe(200);
      expect((await app.inject("/health/ready")).statusCode).toBe(503);
      await admin.pool.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
      expect((await app.inject("/health/ready")).statusCode).toBe(200);
    } finally {
      await admin.pool.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
      await app.close();
      await admin.pool.end();
    }
  });
  it("drains in-flight keep-alive requests and closes newly idle connections", async () => {
    const config = parseConfig(env());
    const app = createApi({ config, logger: createLogger("silent") });
    const entered = Promise.withResolvers<void>();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    let active = 0;
    let closed = false;
    app.get<{ Params: { name: string } }>(
      "/drain-probe/:name",
      async (request) => {
        if (++active === 2) entered.resolve();
        await (request.params.name === "first"
          ? first.promise
          : second.promise);
        return { name: request.params.name };
      },
    );
    const stop = await runApi(app, config, () => Promise.resolve());
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing API listener");
    const firstResponse = fetch(
      `http://127.0.0.1:${address.port}/drain-probe/first`,
    );
    const secondResponse = fetch(
      `http://127.0.0.1:${address.port}/drain-probe/second`,
    );
    try {
      await entered.promise;
      const closing = stop().then(() => {
        closed = true;
      });
      first.resolve();
      expect(await (await firstResponse).json()).toEqual({ name: "first" });
      expect(closed).toBe(false);
      second.resolve();
      expect(await (await secondResponse).json()).toEqual({ name: "second" });
      await expect.poll(() => closed, { timeout: 1000 }).toBe(true);
      await closing;
    } finally {
      first.resolve();
      second.resolve();
      await Promise.allSettled([firstResponse, secondResponse]);
      app.server.closeIdleConnections();
      await stop();
    }
  });
  it.skipIf(process.platform === "win32")(
    "drains an in-flight request on SIGTERM and exits successfully",
    async () => {
      const child = await startApiProcess(env(), "drain");
      try {
        const response = fetch(`${child.address}/slow`);
        await child.waitFor("Slow request started");
        child.process.kill("SIGTERM");
        expect((await response).status).toBe(200);
        expect(await child.exited).toEqual({ code: 0, signal: null });
        expect(child.stderr()).toBe("");
      } finally {
        await child.stop();
      }
    },
  );
});
