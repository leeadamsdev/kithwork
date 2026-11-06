import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";

const required = {
  DATABASE_URL: "postgresql://user:password@localhost/kithwork",
  REDIS_URL: "redis://:password@localhost:6379",
  AUTH_SECRET: "test-only-auth-secret-with-at-least-32-characters",
  MAIL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("API configuration", () => {
  it("requires strong authentication secrets and canonical origins", () => {
    expect(parseConfig(required)).toMatchObject({
      auth: {
        baseURL: "http://127.0.0.1:3001",
        webOrigin: "http://127.0.0.1:5173",
        rateLimitMax: 10,
      },
    });
    for (const invalid of [
      { AUTH_SECRET: undefined },
      { AUTH_SECRET: "short" },
      { MAIL_ENCRYPTION_KEY: "invalid-key" },
      { AUTH_BASE_URL: "https://user:password@example.com" },
      { WEB_ORIGIN: "https://example.com/path" },
      { WEB_ORIGIN: "https://example.com?secret=private" },
      { NODE_ENV: "production" },
      { API_AUTH_RATE_LIMIT_MAX: "0" },
      { API_ORGANISATION_CREATION_RATE_LIMIT_MAX: "0" },
      { API_ORGANISATION_CREATION_RATE_LIMIT_MAX: "1001" },
      { API_INVITATION_SEND_RATE_LIMIT_MAX: "0" },
      { API_INVITATION_SEND_RATE_LIMIT_MAX: "1001" },
      { API_INVITATION_ACCESS_RATE_LIMIT_MAX: "0" },
    ]) {
      expect(() => parseConfig({ ...required, ...invalid })).toThrow(
        "Invalid API configuration",
      );
    }
    expect(
      parseConfig({
        ...required,
        NODE_ENV: "production",
        AUTH_BASE_URL: "https://api.kithwork.test",
        WEB_ORIGIN: "https://app.kithwork.test",
      }),
    ).toMatchObject({ environment: "production" });
  });
  it("defaults to local-only listening and disabled telemetry", () => {
    expect(parseConfig(required)).toMatchObject({
      host: "127.0.0.1",
      port: 3001,
      logLevel: "info",
      telemetry: { enabled: false },
      databaseMaxConnections: 10,
      rateLimitMax: 600,
      organisationCreationRateLimitMax: 5,
      invitationSendRateLimitMax: 10,
      invitationAccessRateLimitMax: 30,
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
