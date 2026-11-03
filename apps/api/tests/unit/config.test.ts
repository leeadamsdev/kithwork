import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";

const required = {
  DATABASE_URL: "postgresql://user:password@localhost/kithwork",
  REDIS_URL: "redis://:password@localhost:6379",
};

describe("API configuration", () => {
  it("defaults to local-only listening and disabled telemetry", () => {
    expect(parseConfig(required)).toMatchObject({
      host: "127.0.0.1",
      port: 3001,
      logLevel: "info",
      telemetry: { enabled: false },
      databaseMaxConnections: 10,
      rateLimitMax: 600,
    });
  });
  it("accepts ephemeral ports and explicit telemetry configuration", () => {
    expect(
      parseConfig({
        ...required,
        API_PORT: "0",
        OTEL_SDK_DISABLED: "false",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318/",
      }),
    ).toMatchObject({
      port: 0,
      telemetry: { enabled: true, endpoint: "http://localhost:4318/" },
    });
  });
  it.each([
    {},
    { ...required, DATABASE_URL: "https://localhost" },
    { ...required, REDIS_URL: "http://localhost" },
    { ...required, API_PORT: "" },
    { ...required, API_PORT: "-1" },
    { ...required, API_PORT: "65536" },
    { ...required, API_PORT: "1.5" },
    { ...required, API_RATE_LIMIT_MAX: "0" },
    { ...required, OTEL_SDK_DISABLED: "no" },
    { ...required, OTEL_SDK_DISABLED: "false" },
    {
      ...required,
      OTEL_SDK_DISABLED: "false",
      OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/traces",
    },
  ])("rejects invalid boundary configuration %#", (env) => {
    expect(() => parseConfig(env)).toThrow("Invalid API configuration");
  });
  it("does not echo credentials in validation errors", () => {
    expect(() =>
      parseConfig({
        ...required,
        REDIS_URL: "https://secret:private@example.com",
      }),
    ).not.toThrow(/private|secret/);
  });
});
