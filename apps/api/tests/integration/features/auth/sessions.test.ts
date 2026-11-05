import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { useAuthFixture } from "./fixtures.js";
describe("sessions", () => {
  const fixture = useAuthFixture();
  it("requires verified email, persists an opaque session, and revokes it on sign-out", async () => {
    const email = `${randomUUID()}@example.test`;
    const password = "correct-horse-battery-staple-123";
    expect((await fixture.app.inject("/trpc/auth.me")).statusCode).toBe(401);
    const signup = await fixture.post("sign-up/email", {
      name: "Lee",
      email,
      password,
      callbackURL: fixture.webOrigin,
    });
    expect(signup.statusCode, signup.body).toBe(200);
    expect(fixture.cookieFrom(signup)).not.toContain("session_token");
    expect(
      (await fixture.post("sign-in/email", { email, password })).statusCode,
    ).toBe(403);
    const link = await fixture.emailLink(email, "verify-email");
    expect(link.origin).toBe(fixture.baseURL);
    const verification = await fixture.app.inject(link.pathname + link.search);
    expect(verification.statusCode).toBe(302);
    expect(fixture.cookieFrom(verification)).not.toContain("session_token");
    const login = await fixture.post("sign-in/email", { email, password });
    expect(login.statusCode).toBe(200);
    const cookie = fixture.cookieFrom(login);
    expect(cookie).toContain("session_token");
    expect(JSON.stringify(login.headers["set-cookie"])).toMatch(/HttpOnly/);
    expect(JSON.stringify(login.headers["set-cookie"])).toMatch(/Secure/);
    const me = await fixture.app.inject({
      url: "/trpc/auth.me",
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    expect(me.json()).toMatchObject({
      result: { data: { email, emailVerified: true } },
    });
    expect(me.body).not.toMatch(/session_token|password|accessToken/);
    const stored = await fixture.database.pool.query<{ password: string }>(
      "SELECT password FROM auth_account WHERE provider_id = 'credential'",
    );
    expect(
      stored.rows.some((row) => row.password && row.password !== password),
    ).toBe(true);
    expect((await fixture.post("sign-out", {}, cookie)).statusCode).toBe(200);
    expect(
      (await fixture.app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it("rejects expired sessions and forged identity headers", async () => {
    const user = await fixture.verifiedUser();
    const cookie = fixture.cookieFrom(
      await fixture.post("sign-in/email", user),
    );
    const me = await fixture.app.inject({
      url: "/trpc/auth.me",
      headers: { cookie },
    });
    const id = me.json<{ result: { data: { id: string } } }>().result.data.id;
    await fixture.database.pool.query(
      "UPDATE auth_session SET expires_at = now() - interval '1 hour' WHERE user_id = $1",
      [id],
    );
    expect(
      (await fixture.app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await fixture.app.inject({
          url: "/trpc/auth.me",
          headers: { "x-user-id": id },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await fixture.app.inject({
          url: "/trpc/auth.me",
          headers: { cookie: cookie + "tampered" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("does not leak opaque session tokens when a database lookup fails", async () => {
    const user = await fixture.verifiedUser();
    const cookie = fixture.cookieFrom(
      await fixture.post("sign-in/email", user),
    );
    const rows = await fixture.database.pool.query<{ token: string }>(
      "SELECT token FROM auth_session WHERE user_id = (SELECT id FROM auth_user WHERE email = $1)",
      [user.email],
    );
    await fixture.database.pool.query(
      "ALTER TABLE auth_session RENAME TO unavailable_auth_session",
    );
    try {
      const response = await fixture.app.inject({
        url: "/trpc/auth.me",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(500);
      expect(rows.rows.every((row) => !response.body.includes(row.token))).toBe(
        true,
      );
      expect(
        rows.rows.every(
          (row) => !fixture.logLines.some((line) => line.includes(row.token)),
        ),
      ).toBe(true);
    } finally {
      await fixture.database.pool.query(
        "ALTER TABLE unavailable_auth_session RENAME TO auth_session",
      );
    }
  });
});
