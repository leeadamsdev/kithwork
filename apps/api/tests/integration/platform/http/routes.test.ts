import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createApi } from "../../../../src/app.js";
import { parseConfig } from "../../../../src/config.js";
import { createLogger } from "@kithwork/logging";
import type { AppRouter } from "../../../../src/platform/trpc/router.js";
import { createTestDatabase } from "../../../../../../tests/integration/platform/database/fixtures.js";
import { uniqueNamespace } from "../../../../../../tests/integration/support/namespace.js";
import { integrationServices } from "../../../../../../tests/integration/context.js";
import { apiTestEnvironment } from "../../../fixtures/config.js";

describe("API HTTP boundary", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApi>;
  beforeAll(async () => {
    database = await createTestDatabase({ migrate: true });
    const config = parseConfig({
      ...apiTestEnvironment,
      DATABASE_URL: database.connectionString,
      REDIS_URL: integrationServices().redisUrl,
      API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
      API_PORT: "0",
    });
    app = createApi({ config, logger: createLogger("silent") });
    app.get("/unexpected", () => {
      throw new Error("private database details");
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it("reports liveness and dependency readiness without caching", async () => {
    for (const url of ["/health/live", "/health/ready"]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({
        status: url.endsWith("live") ? "ok" : "ready",
      });
    }
  });
  it("replaces untrusted request IDs and applies security headers", async () => {
    const response = await app.inject({
      url: "/health/live",
      headers: { "x-request-id": "caller-controlled" },
    });
    expect(response.headers["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("serves a validated tRPC contract", async () => {
    const response = await app.inject("/trpc/system.info");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: { data: { name: "kithwork-api", version: "0.0.0" } },
    });
  });
  it("prevents caching tRPC successes, errors and mixed batches", async () => {
    for (const [url, status] of [
      ["/trpc/system.info", 200],
      ["/trpc/auth.me", 401],
      ["/trpc/does-not-exist", 404],
      ["/trpc/system.info,auth.me?batch=1", 207],
    ] as const) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(status);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });
  it("preserves safe tRPC errors and request correlation", async () => {
    const response = await app.inject("/trpc/does-not-exist");
    expect(response.statusCode).toBe(404);
    const body: { error: { data: { requestId: string; stack?: string } } } =
      response.json();
    expect(body.error.data.requestId).toBe(response.headers["x-request-id"]);
    expect(body.error.data.stack).toBeUndefined();
  });
  it("bounds batch sizes and request bodies", async () => {
    const batch = await app.inject(
      `/trpc/${Array.from({ length: 11 }, () => "system.info").join(",")}?batch=1`,
    );
    expect(batch.statusCode).toBe(400);
    const body = await app.inject({
      method: "POST",
      url: "/trpc/system.info",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ input: "x".repeat(1024 * 1024) }),
    });
    expect(body.statusCode).toBe(413);
  });
  it("returns safe HTTP errors and not-found responses", async () => {
    const response = await app.inject("/unexpected");
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/private|stack|database/);
    expect(response.json()).toEqual({
      error: "Internal Server Error",
      requestId: response.headers["x-request-id"],
    });
    expect((await app.inject("/missing")).statusCode).toBe(404);
  });
  it("supports a real typed client over HTTP", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${address}/trpc` })],
    });
    expect(await client.system.info.query()).toEqual({
      name: "kithwork-api",
      version: "0.0.0",
    });
  });
});

it("shares Redis-backed rate limits across API instances and unmatched URLs while exempting health probes", async () => {
  const database = await createTestDatabase({ migrate: true });
  const config = parseConfig({
    ...apiTestEnvironment,
    DATABASE_URL: database.connectionString,
    REDIS_URL: integrationServices().redisUrl,
    API_RATE_LIMIT_MAX: "2",
    API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
  });
  const first = createApi({ config, logger: createLogger("silent") });
  const second = createApi({ config, logger: createLogger("silent") });
  try {
    await Promise.all([first.ready(), second.ready()]);
    const notFound = await first.inject("/missing");
    expect(notFound.statusCode).toBe(404);
    expect(notFound.headers["x-ratelimit-remaining"]).toBe("1");
    expect((await second.inject("/trpc/system.info")).statusCode).toBe(200);
    const rejected = await first.inject("/trpc/system.info");
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers["retry-after"]).toBeDefined();
    const rejectedNotFound = await second.inject("/another-missing-url");
    expect(rejectedNotFound.statusCode).toBe(429);
    expect(rejectedNotFound.headers["retry-after"]).toBeDefined();
    expect(rejectedNotFound.json()).toEqual({
      error: "Too Many Requests",
      requestId: rejectedNotFound.headers["x-request-id"],
    });
    expect((await first.inject("/health/live")).statusCode).toBe(200);
    expect((await second.inject("/health/ready")).statusCode).toBe(200);
  } finally {
    await Promise.all([first.close(), second.close()]);
    await database.close();
  }
});
