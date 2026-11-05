import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { migrateDatabase } from "@kithwork/database/migrate";
import { createEmailWorker, createSmtpDelivery } from "@kithwork/email/worker";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../src/app.js";
import { parseConfig } from "../../../../src/config.js";
import { apiTestEnvironment } from "../../../fixtures/config.js";
import { createTestDatabase } from "../../../../../../tests/integration/platform/database/fixtures.js";
import { uniqueNamespace } from "../../../../../../tests/integration/support/namespace.js";
import { integrationServices } from "../../../../../../tests/integration/context.js";

export function useAuthFixture() {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApi>;
  let worker: Awaited<ReturnType<typeof createEmailWorker>>;
  let smtp: ReturnType<typeof createSmtpDelivery>;
  const webOrigin = "https://app.kithwork.test";
  const baseURL = "https://api.kithwork.test";
  const prefix = uniqueNamespace();
  const logLines: string[] = [];
  afterEach(() => vi.restoreAllMocks());
  beforeAll(async () => {
    database = await createTestDatabase();
    await migrateDatabase({
      connectionString: database.connectionString,
      migrationsFolder: fileURLToPath(
        new URL(
          "../../../../../../packages/database/migrations/",
          import.meta.url,
        ),
      ),
      onPoolError: database.onPoolError,
    });
    const services = integrationServices();
    smtp = createSmtpDelivery({
      host: services.smtpHost,
      port: services.smtpPort,
      from: "Kithwork <no-reply@kithwork.test>",
      secure: false,
      requireTLS: false,
    });
    worker = await createEmailWorker({
      redisUrl: services.redisUrl,
      encryptionKey: apiTestEnvironment.MAIL_ENCRYPTION_KEY,
      prefix,
      concurrency: 2,
      deliver: smtp.deliver,
      onEvent: () => {},
    });
    app = createApi({
      config: parseConfig({
        ...apiTestEnvironment,
        DATABASE_URL: database.connectionString,
        REDIS_URL: services.redisUrl,
        AUTH_BASE_URL: baseURL,
        WEB_ORIGIN: webOrigin,
        EMAIL_QUEUE_PREFIX: prefix,
        API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
        API_AUTH_RATE_LIMIT_MAX: "100",
      }),
      logger: createLogger(
        "info",
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            logLines.push(chunk.toString());
            done();
          },
        }),
      ),
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await worker?.close();
    smtp?.close();
    await database?.close();
  });
  const post = (
    path: string,
    payload: Record<string, unknown>,
    cookie?: string,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/auth/${path}`,
      payload,
      headers: { origin: webOrigin, ...(cookie ? { cookie } : {}) },
    });
  const cookieFrom = (response: Awaited<ReturnType<typeof post>>) => {
    const raw = response.headers["set-cookie"];
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  };
  async function emailLink(
    to: string,
    kind: "verify-email" | "reset-password",
  ) {
    let link = "";
    await expect
      .poll(
        async () => {
          const response = await fetch(
            `${integrationServices().mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
          );
          const body = (await response.json()) as {
            messages: { ID: string }[];
          };
          for (const message of body.messages) {
            const detail = (await (
              await fetch(
                `${integrationServices().mailpitUrl}/api/v1/message/${message.ID}`,
              )
            ).json()) as { Text: string };
            const found = detail.Text.match(
              new RegExp(
                `https://api\\.kithwork\\.test/api/auth/${kind}[^\\s<>]*`,
              ),
            );
            if (found) {
              link = found[0];
              return true;
            }
          }
          return false;
        },
        { timeout: 5000 },
      )
      .toBe(true);
    return new URL(link);
  }
  async function verifiedUser() {
    const email = `${randomUUID()}@example.test`;
    const password = "correct-horse-battery-staple-123";
    const signup = await post("sign-up/email", {
      name: "Lee",
      email,
      password,
      callbackURL: webOrigin,
    });
    expect(signup.statusCode, signup.body).toBe(200);
    const link = await emailLink(email, "verify-email");
    expect((await app.inject(link.pathname + link.search)).statusCode).toBe(
      302,
    );
    return { email, password };
  }
  return {
    get database() {
      return database;
    },
    get app() {
      return app;
    },
    webOrigin,
    baseURL,
    logLines,
    post,
    cookieFrom,
    emailLink,
    verifiedUser,
  };
}
