import { expect, it } from "vitest";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../src/app.js";
import { parseConfig } from "../../../../src/config.js";
import { apiTestEnvironment } from "../../../fixtures/config.js";
import { createTestDatabase } from "../../../../../../tests/integration/platform/database/fixtures.js";
import { uniqueNamespace } from "../../../../../../tests/integration/support/namespace.js";
import { integrationServices } from "../../../../../../tests/integration/context.js";
it("shares atomic authentication write limits across API instances and ignores forwarded-IP spoofing", async () => {
  const database = await createTestDatabase({ migrate: true });
  const config = parseConfig({
    ...apiTestEnvironment,
    DATABASE_URL: database.connectionString,
    REDIS_URL: integrationServices().redisUrl,
    API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
    EMAIL_QUEUE_PREFIX: uniqueNamespace(),
    API_AUTH_RATE_LIMIT_MAX: "2",
  });
  const first = createApi({ config, logger: createLogger("silent") });
  const second = createApi({ config, logger: createLogger("silent") });
  const attempt = (instance: typeof first, ip: string) =>
    instance.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: {
        origin: config.auth.webOrigin,
        "x-forwarded-for": ip,
        "x-kithwork-client-ip": ip,
      },
      payload: {
        email: "absent@example.test",
        password: "wrong-but-long-password",
      },
    });
  try {
    await Promise.all([first.ready(), second.ready()]);
    expect((await attempt(first, "1.1.1.1")).statusCode).toBe(401);
    expect((await attempt(second, "2.2.2.2")).statusCode).toBe(401);
    const limited = await attempt(first, "3.3.3.3");
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await second.inject("/api/auth/get-session")).statusCode).toBe(200);
    expect((await second.inject("/health/ready")).statusCode).toBe(200);
  } finally {
    await Promise.all([first.close(), second.close()]);
    await database.close();
  }
});
