import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { migrateDatabase } from "@kithwork/database/migrate";
import { createEmailWorker, createSmtpDelivery } from "@kithwork/email/worker";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../src/app.js";
import { parseConfig } from "../../src/config.js";
import { apiTestEnvironment } from "../fixtures/config.js";
import {
  createTestDatabase,
  uniqueNamespace,
} from "../../../../tests/integration/fixtures.js";
import { integrationServices } from "../../../../tests/integration/context.js";

describe("authentication HTTP lifecycle", () => {
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
        new URL("../../../../packages/database/migrations/", import.meta.url),
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

  it("requires verified email, persists an opaque session, and revokes it on sign-out", async () => {
    const email = `${randomUUID()}@example.test`;
    const password = "correct-horse-battery-staple-123";
    expect((await app.inject("/trpc/auth.me")).statusCode).toBe(401);
    const signup = await post("sign-up/email", {
      name: "Lee",
      email,
      password,
      callbackURL: webOrigin,
    });
    expect(signup.statusCode, signup.body).toBe(200);
    expect(cookieFrom(signup)).not.toContain("session_token");
    expect((await post("sign-in/email", { email, password })).statusCode).toBe(
      403,
    );
    const link = await emailLink(email, "verify-email");
    expect(link.origin).toBe(baseURL);
    const verification = await app.inject(link.pathname + link.search);
    expect(verification.statusCode).toBe(302);
    expect(cookieFrom(verification)).not.toContain("session_token");
    const login = await post("sign-in/email", { email, password });
    expect(login.statusCode).toBe(200);
    const cookie = cookieFrom(login);
    expect(cookie).toContain("session_token");
    expect(JSON.stringify(login.headers["set-cookie"])).toMatch(/HttpOnly/);
    expect(JSON.stringify(login.headers["set-cookie"])).toMatch(/Secure/);
    const me = await app.inject({ url: "/trpc/auth.me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    expect(me.json()).toMatchObject({
      result: { data: { email, emailVerified: true } },
    });
    expect(me.body).not.toMatch(/session_token|password|accessToken/);
    const stored = await database.pool.query<{ password: string }>(
      "SELECT password FROM auth_account WHERE provider_id = 'credential'",
    );
    expect(
      stored.rows.some((row) => row.password && row.password !== password),
    ).toBe(true);
    expect((await post("sign-out", {}, cookie)).statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it("spends reset tokens once and atomically revokes every existing session", async () => {
    const user = await verifiedUser();
    const first = cookieFrom(await post("sign-in/email", user));
    const second = cookieFrom(await post("sign-in/email", user));
    const requested = await post("request-password-reset", {
      email: user.email,
      redirectTo: `${webOrigin}/reset-password`,
    });
    expect(requested.statusCode).toBe(200);
    const unknown = await post("request-password-reset", {
      email: `${randomUUID()}@example.test`,
      redirectTo: `${webOrigin}/reset-password`,
    });
    expect(unknown.body).toBe(requested.body);
    const link = await emailLink(user.email, "reset-password");
    const token = link.pathname.split("/").at(-1)!;
    const newPassword = "a-new-long-password-123456";
    expect(
      (await post("reset-password", { token, newPassword })).statusCode,
    ).toBe(200);
    for (const cookie of [first, second]) {
      expect(
        (await app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
          .statusCode,
      ).toBe(401);
    }
    expect((await post("sign-in/email", user)).statusCode).toBe(401);
    expect(
      (
        await post("sign-in/email", {
          email: user.email,
          password: newPassword,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post("reset-password", {
          token,
          newPassword: "another-long-password-123",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects expired sessions and forged identity headers", async () => {
    const user = await verifiedUser();
    const cookie = cookieFrom(await post("sign-in/email", user));
    const me = await app.inject({ url: "/trpc/auth.me", headers: { cookie } });
    const id = me.json<{ result: { data: { id: string } } }>().result.data.id;
    await database.pool.query(
      "UPDATE auth_session SET expires_at = now() - interval '1 hour' WHERE user_id = $1",
      [id],
    );
    expect(
      (await app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: "/trpc/auth.me", headers: { "x-user-id": id } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: "/trpc/auth.me",
          headers: { cookie: cookie + "tampered" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("resends verification mail without exposing existing accounts during signup", async () => {
    const email = `${randomUUID()}@example.test`;
    const payload = {
      email,
      name: "Lee",
      password: "correct-horse-battery-staple-123",
    };
    const first = await post("sign-up/email", payload);
    const duplicate = await post("sign-up/email", {
      ...payload,
      email: email.toUpperCase(),
    });
    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(200);
    const firstBody = first.json<{
      user: { id: string };
      token: string | null;
    }>();
    const secondBody = duplicate.json<typeof firstBody>();
    expect(Object.keys(firstBody).sort()).toEqual(
      Object.keys(secondBody).sort(),
    );
    expect(Object.keys(firstBody.user).sort()).toEqual(
      Object.keys(secondBody.user).sort(),
    );
    expect(secondBody.token).toBeNull();
    expect(secondBody.user.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      (
        await database.pool.query(
          "SELECT id FROM auth_user WHERE lower(email) = lower($1)",
          [email],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await post("send-verification-email", { email, callbackURL: webOrigin }))
        .statusCode,
    ).toBe(200);
    await expect
      .poll(
        async () => {
          const response = await fetch(
            `${integrationServices().mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
          );
          return ((await response.json()) as { messages: unknown[] }).messages
            .length;
        },
        { timeout: 5000 },
      )
      .toBe(2);
  });

  it("allows only one concurrent password reset to consume a reset link", async () => {
    const user = await verifiedUser();
    await post("request-password-reset", {
      email: user.email,
      redirectTo: `${webOrigin}/reset-password`,
    });
    const token = (await emailLink(user.email, "reset-password")).pathname
      .split("/")
      .at(-1)!;
    const passwords = [
      "first-concurrent-password-12345",
      "second-concurrent-password-67890",
    ];
    const results = await Promise.all(
      passwords.map((newPassword) =>
        post("reset-password", { token, newPassword }),
      ),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 400,
    ]);
    const logins = await Promise.all(
      passwords.map((password) =>
        post("sign-in/email", { email: user.email, password }),
      ),
    );
    expect(logins.map((result) => result.statusCode).sort()).toEqual([
      200, 401,
    ]);
  });

  it("rejects expired reset links without changing the password", async () => {
    const user = await verifiedUser();
    await post("request-password-reset", {
      email: user.email,
      redirectTo: `${webOrigin}/reset-password`,
    });
    const token = (await emailLink(user.email, "reset-password")).pathname
      .split("/")
      .at(-1)!;
    await database.pool.query(
      "UPDATE auth_verification SET expires_at = now() - interval '1 hour' WHERE value = (SELECT id::text FROM auth_user WHERE email = $1)",
      [user.email],
    );
    expect(
      (
        await post("reset-password", {
          token,
          newPassword: "another-long-password-123",
        })
      ).statusCode,
    ).toBe(400);
    expect((await post("sign-in/email", user)).statusCode).toBe(200);
    const stored = await database.pool.query<{ identifier: string }>(
      "SELECT identifier FROM auth_verification",
    );
    expect(stored.rows.some((row) => row.identifier.includes(token))).toBe(
      false,
    );
  });

  it("preserves multiple session cookies and rejects untrusted browser origins and redirects", async () => {
    const user = await verifiedUser();
    const response = await post("sign-in/email", {
      ...user,
      rememberMe: false,
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.headers["set-cookie"])).toBe(true);
    expect(
      (response.headers["set-cookie"] as string[]).length,
    ).toBeGreaterThanOrEqual(2);
    expect(response.headers["cache-control"]).toBe("no-store");
    const cookie = cookieFrom(response);
    const attack = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie, origin: "https://attacker.test" },
      payload: {},
    });
    expect(attack.statusCode).toBe(403);
    expect(
      (await app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    for (const redirectTo of [
      "https://attacker.test",
      "https://app.kithwork.test.attacker.test",
      "javascript:alert(1)",
    ]) {
      expect(
        (
          await post("request-password-reset", {
            email: user.email,
            redirectTo,
          })
        ).statusCode,
      ).toBe(403);
    }
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/sign-in/email",
      headers: {
        origin: webOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(webOrigin);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    const untrusted = await app.inject({
      url: "/api/auth/get-session",
      headers: { origin: "https://attacker.test" },
    });
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "text/plain", origin: webOrigin },
      payload: "not-json",
    });
    expect(unsupported.statusCode).toBe(415);
  });

  it("does not announce readiness before authentication migrations exist", async () => {
    const blank = await createTestDatabase();
    const instance = createApi({
      config: parseConfig({
        ...apiTestEnvironment,
        DATABASE_URL: blank.connectionString,
        REDIS_URL: integrationServices().redisUrl,
        EMAIL_QUEUE_PREFIX: uniqueNamespace(),
        API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
      }),
      logger: createLogger("silent"),
    });
    try {
      const error = await instance.ready().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ code: "42P01" });
    } finally {
      await instance.close();
      await blank.close();
    }
  });

  it("rolls back token consumption and session revocation when password persistence fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const logStart = logLines.length;
    const user = await verifiedUser();
    const cookie = cookieFrom(await post("sign-in/email", user));
    await post("request-password-reset", {
      email: user.email,
      redirectTo: `${webOrigin}/reset-password`,
    });
    const token = (await emailLink(user.email, "reset-password")).pathname
      .split("/")
      .at(-1)!;
    await database.pool.query(
      "CREATE FUNCTION reject_auth_password() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-password-database-error'; END; $$",
    );
    await database.pool.query(
      "CREATE TRIGGER reject_auth_password BEFORE UPDATE OF password ON auth_account FOR EACH ROW EXECUTE FUNCTION reject_auth_password()",
    );
    try {
      const failed = await post("reset-password", {
        token,
        newPassword: "the-new-reset-password-12345",
      });
      expect(failed.statusCode).toBe(500);
      expect(failed.body).not.toContain("private-password-database-error");
      expect(
        (await app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
          .statusCode,
      ).toBe(200);
      expect((await post("sign-in/email", user)).statusCode).toBe(200);
    } finally {
      await database.pool.query(
        "DROP TRIGGER reject_auth_password ON auth_account",
      );
      await database.pool.query("DROP FUNCTION reject_auth_password()");
    }
    expect(
      (
        await post("reset-password", {
          token,
          newPassword: "the-new-reset-password-12345",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      logLines.slice(logStart).some((line) => {
        const entry = JSON.parse(line) as { level: number; reqId?: string };
        return entry.level === 50 && typeof entry.reqId === "string";
      }),
    ).toBe(true);
    expect(
      logLines.some((line) => line.includes("private-password-database-error")),
    ).toBe(false);
    expect(logLines.some((line) => line.includes(token))).toBe(false);
    expect(consoleError.mock.calls.length).toBe(0);
  });

  it("does not leak opaque session tokens when a database lookup fails", async () => {
    const user = await verifiedUser();
    const cookie = cookieFrom(await post("sign-in/email", user));
    const rows = await database.pool.query<{ token: string }>(
      "SELECT token FROM auth_session WHERE user_id = (SELECT id FROM auth_user WHERE email = $1)",
      [user.email],
    );
    await database.pool.query(
      "ALTER TABLE auth_session RENAME TO unavailable_auth_session",
    );
    try {
      const response = await app.inject({
        url: "/trpc/auth.me",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(500);
      expect(rows.rows.every((row) => !response.body.includes(row.token))).toBe(
        true,
      );
      expect(
        rows.rows.every(
          (row) => !logLines.some((line) => line.includes(row.token)),
        ),
      ).toBe(true);
    } finally {
      await database.pool.query(
        "ALTER TABLE unavailable_auth_session RENAME TO auth_session",
      );
    }
  });

  it("rejects oversized authentication bodies before creating an account", async () => {
    const email = `${randomUUID()}@example.test`;
    const response = await post("sign-up/email", {
      name: "x".repeat(20_000),
      email,
      password: "a-long-valid-password-12345",
    });
    expect(response.statusCode).toBe(413);
    expect(
      (
        await database.pool.query("SELECT id FROM auth_user WHERE email = $1", [
          email,
        ])
      ).rows,
    ).toEqual([]);
  });

  it("delivers a maximum-length email and callback using the configured origin despite forged host headers", async () => {
    const email = `${randomUUID().replaceAll("-", "")}${"a".repeat(32)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(56)}.test`;
    expect(email).toHaveLength(254);
    const callbackBase = `${webOrigin}/`;
    const callbackURL =
      callbackBase + "x".repeat(2048 - encodeURIComponent(callbackBase).length);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        origin: webOrigin,
        host: "attacker.test",
        "x-forwarded-host": "attacker.test",
        "x-forwarded-proto": "http",
      },
      payload: {
        email,
        name: "Lee",
        password: "correct-horse-battery-staple-123",
        callbackURL,
      },
    });
    expect(response.statusCode).toBe(200);
    const link = await emailLink(email, "verify-email");
    expect(link.origin).toBe(baseURL);
    expect(link.href.length).toBeLessThanOrEqual(4096);
    const verified = await app.inject(link.pathname + link.search);
    expect(verified.statusCode).toBe(302);
    expect(verified.headers.location).toBe(callbackURL);
  });

  it("rejects oversized redirects before account lookup for both existing and unknown emails", async () => {
    const email = `${randomUUID()}@example.test`;
    expect(
      (
        await post("sign-up/email", {
          name: "Lee",
          email,
          password: "correct-horse-battery-staple-123",
        })
      ).statusCode,
    ).toBe(200);
    const before = await database.pool.query<{ count: string }>(
      "SELECT count(*) FROM auth_verification",
    );
    const oversized = [
      `${webOrigin}/${"x".repeat(5000)}`,
      `${webOrigin}/${"é".repeat(900)}`,
    ];
    for (const redirect of oversized) {
      for (const address of [email, `${randomUUID()}@example.test`]) {
        const reset = await post("request-password-reset", {
          email: address,
          redirectTo: redirect,
        });
        expect(reset.statusCode).toBe(400);
        const verification = await post("send-verification-email", {
          email: address,
          callbackURL: redirect,
        });
        expect(verification.statusCode).toBe(400);
      }
    }
    const after = await database.pool.query<{ count: string }>(
      "SELECT count(*) FROM auth_verification",
    );
    expect(after.rows).toEqual(before.rows);
    const tooLongEmail = `${"a".repeat(64)}@${"b".repeat(190)}.test`;
    expect(
      (await post("request-password-reset", { email: tooLongEmail }))
        .statusCode,
    ).toBe(400);
  });
});

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
