import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { useAuthFixture } from "./fixtures.js";
describe("password reset", () => {
  const fixture = useAuthFixture();
  it("spends reset tokens once and atomically revokes every existing session", async () => {
    const user = await fixture.verifiedUser();
    const first = fixture.cookieFrom(await fixture.post("sign-in/email", user));
    const second = fixture.cookieFrom(
      await fixture.post("sign-in/email", user),
    );
    const requested = await fixture.post("request-password-reset", {
      email: user.email,
      redirectTo: `${fixture.webOrigin}/reset-password`,
    });
    expect(requested.statusCode).toBe(200);
    const unknown = await fixture.post("request-password-reset", {
      email: `${randomUUID()}@example.test`,
      redirectTo: `${fixture.webOrigin}/reset-password`,
    });
    expect(unknown.body).toBe(requested.body);
    const link = await fixture.emailLink(user.email, "reset-password");
    const token = link.pathname.split("/").at(-1)!;
    const newPassword = "a-new-long-password-123456";
    expect(
      (await fixture.post("reset-password", { token, newPassword })).statusCode,
    ).toBe(200);
    for (const cookie of [first, second]) {
      expect(
        (
          await fixture.app.inject({
            url: "/trpc/auth.me",
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect((await fixture.post("sign-in/email", user)).statusCode).toBe(401);
    expect(
      (
        await fixture.post("sign-in/email", {
          email: user.email,
          password: newPassword,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.post("reset-password", {
          token,
          newPassword: "another-long-password-123",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("allows only one concurrent password reset to consume a reset link", async () => {
    const user = await fixture.verifiedUser();
    await fixture.post("request-password-reset", {
      email: user.email,
      redirectTo: `${fixture.webOrigin}/reset-password`,
    });
    const token = (
      await fixture.emailLink(user.email, "reset-password")
    ).pathname
      .split("/")
      .at(-1)!;
    const passwords = [
      "first-concurrent-password-12345",
      "second-concurrent-password-67890",
    ];
    const results = await Promise.all(
      passwords.map((newPassword) =>
        fixture.post("reset-password", { token, newPassword }),
      ),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 400,
    ]);
    const logins = await Promise.all(
      passwords.map((password) =>
        fixture.post("sign-in/email", { email: user.email, password }),
      ),
    );
    expect(logins.map((result) => result.statusCode).sort()).toEqual([
      200, 401,
    ]);
  });
  it("rejects expired reset links without changing the password", async () => {
    const user = await fixture.verifiedUser();
    await fixture.post("request-password-reset", {
      email: user.email,
      redirectTo: `${fixture.webOrigin}/reset-password`,
    });
    const token = (
      await fixture.emailLink(user.email, "reset-password")
    ).pathname
      .split("/")
      .at(-1)!;
    await fixture.database.pool.query(
      "UPDATE auth_verification SET expires_at = now() - interval '1 hour' WHERE value = (SELECT id::text FROM auth_user WHERE email = $1)",
      [user.email],
    );
    expect(
      (
        await fixture.post("reset-password", {
          token,
          newPassword: "another-long-password-123",
        })
      ).statusCode,
    ).toBe(400);
    expect((await fixture.post("sign-in/email", user)).statusCode).toBe(200);
    const stored = await fixture.database.pool.query<{ identifier: string }>(
      "SELECT identifier FROM auth_verification",
    );
    expect(stored.rows.some((row) => row.identifier.includes(token))).toBe(
      false,
    );
  });
  it("rolls back token consumption and session revocation when password persistence fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const logStart = fixture.logLines.length;
    const user = await fixture.verifiedUser();
    const cookie = fixture.cookieFrom(
      await fixture.post("sign-in/email", user),
    );
    await fixture.post("request-password-reset", {
      email: user.email,
      redirectTo: `${fixture.webOrigin}/reset-password`,
    });
    const token = (
      await fixture.emailLink(user.email, "reset-password")
    ).pathname
      .split("/")
      .at(-1)!;
    await fixture.database.pool.query(
      "CREATE FUNCTION reject_auth_password() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-password-database-error'; END; $$",
    );
    await fixture.database.pool.query(
      "CREATE TRIGGER reject_auth_password BEFORE UPDATE OF password ON auth_account FOR EACH ROW EXECUTE FUNCTION reject_auth_password()",
    );
    try {
      const failed = await fixture.post("reset-password", {
        token,
        newPassword: "the-new-reset-password-12345",
      });
      expect(failed.statusCode).toBe(500);
      expect(failed.body).not.toContain("private-password-database-error");
      expect(
        (
          await fixture.app.inject({
            url: "/trpc/auth.me",
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(200);
      expect((await fixture.post("sign-in/email", user)).statusCode).toBe(200);
    } finally {
      await fixture.database.pool.query(
        "DROP TRIGGER reject_auth_password ON auth_account",
      );
      await fixture.database.pool.query("DROP FUNCTION reject_auth_password()");
    }
    expect(
      (
        await fixture.post("reset-password", {
          token,
          newPassword: "the-new-reset-password-12345",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      fixture.logLines.slice(logStart).some((line) => {
        const entry = JSON.parse(line) as { level: number; reqId?: string };
        return entry.level === 50 && typeof entry.reqId === "string";
      }),
    ).toBe(true);
    expect(
      fixture.logLines.some((line) =>
        line.includes("private-password-database-error"),
      ),
    ).toBe(false);
    expect(fixture.logLines.some((line) => line.includes(token))).toBe(false);
    expect(consoleError.mock.calls.length).toBe(0);
  });
});
