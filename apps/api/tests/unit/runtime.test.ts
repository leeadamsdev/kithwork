import Fastify from "fastify";
import { expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { runApi } from "../../src/runtime.js";
import { apiTestEnvironment } from "../fixtures/config.js";

const config = parseConfig({
  ...apiTestEnvironment,
  DATABASE_URL: "postgresql://localhost/test",
  REDIS_URL: "redis://localhost",
  API_PORT: "0",
});

it("does not open a listener after a shutdown signal interrupts startup", async () => {
  const entered = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const app = Fastify();
  let telemetryCloses = 0;
  app.addHook("onReady", async () => {
    entered.resolve();
    await ready.promise;
  });
  const starting = runApi(app, config, () => {
    telemetryCloses++;
    return Promise.resolve();
  });
  try {
    await entered.promise;
    process.emit("SIGTERM");
    ready.resolve();
    const stop = await starting;
    await stop();
    expect(app.server.listening).toBe(false);
    expect(telemetryCloses).toBe(1);
  } finally {
    ready.resolve();
    await app.close();
    if (app.server.listening)
      await new Promise<void>((resolve) => {
        app.server.close(() => resolve());
      });
  }
});

it("coalesces shutdown calls and closes telemetry after in-flight work", async () => {
  const app = Fastify();
  const events: string[] = [];
  app.addHook("onClose", async () => {
    events.push("app");
    await Promise.resolve();
  });
  const stop = await runApi(app, config, () => {
    events.push("telemetry");
    return Promise.resolve();
  });
  await Promise.all([stop(), stop()]);
  expect(app.server.listening).toBe(false);
  expect(events).toEqual(["app", "telemetry"]);
});
