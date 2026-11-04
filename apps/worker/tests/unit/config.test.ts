import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { parseWorkerConfig } from "../../src/config.js";

const env = {
  REDIS_URL: "redis://:secret-marker@127.0.0.1:6379",
  MAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
it("validates email worker configuration and keeps local defaults explicit", () => {
  const config = parseWorkerConfig(env);
  expect(config.smtp).toMatchObject({
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    requireTLS: false,
  });
  expect(config.concurrency).toBe(2);
});
it("rejects insecure production mail and partial SMTP authentication without printing secrets", () => {
  for (const input of [
    { ...env, NODE_ENV: "production" },
    { ...env, SMTP_USER: "secret-marker" },
    { ...env, MAIL_ENCRYPTION_KEY: "secret-marker" },
    { ...env, EMAIL_WORKER_CONCURRENCY: "0" },
  ]) {
    expect(() => parseWorkerConfig(input)).toThrow(
      "Invalid worker configuration",
    );
    try {
      parseWorkerConfig(input);
    } catch (error) {
      expect(String(error)).not.toContain("secret-marker");
    }
  }
  expect(
    parseWorkerConfig({
      ...env,
      NODE_ENV: "production",
      SMTP_REQUIRE_TLS: "true",
    }).smtp.requireTLS,
  ).toBe(true);
});
