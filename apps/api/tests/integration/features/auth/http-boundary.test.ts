import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { useAuthFixture } from "./fixtures.js";
describe("http boundary", () => {
  const fixture = useAuthFixture();
  it("preserves multiple session cookies and rejects untrusted browser origins and redirects", async () => {
    const user = await fixture.verifiedUser();
    const response = await fixture.post("sign-in/email", {
      ...user,
      rememberMe: false,
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.headers["set-cookie"])).toBe(true);
    expect(
      (response.headers["set-cookie"] as string[]).length,
    ).toBeGreaterThanOrEqual(2);
    expect(response.headers["cache-control"]).toBe("no-store");
    const cookie = fixture.cookieFrom(response);
    const attack = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie, origin: "https://attacker.test" },
      payload: {},
    });
    expect(attack.statusCode).toBe(403);
    expect(
      (await fixture.app.inject({ url: "/trpc/auth.me", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    for (const redirectTo of [
      "https://attacker.test",
      "https://app.kithwork.test.attacker.test",
      "javascript:alert(1)",
    ]) {
      expect(
        (
          await fixture.post("request-password-reset", {
            email: user.email,
            redirectTo,
          })
        ).statusCode,
      ).toBe(403);
    }
    const preflight = await fixture.app.inject({
      method: "OPTIONS",
      url: "/api/auth/sign-in/email",
      headers: {
        origin: fixture.webOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(
      fixture.webOrigin,
    );
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    const untrusted = await fixture.app.inject({
      url: "/api/auth/get-session",
      headers: { origin: "https://attacker.test" },
    });
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
    const unsupported = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "text/plain", origin: fixture.webOrigin },
      payload: "not-json",
    });
    expect(unsupported.statusCode).toBe(415);
  });
  it("rejects oversized authentication bodies before creating an account", async () => {
    const email = `${randomUUID()}@example.test`;
    const response = await fixture.post("sign-up/email", {
      name: "x".repeat(20_000),
      email,
      password: "a-long-valid-password-12345",
    });
    expect(response.statusCode).toBe(413);
    expect(
      (
        await fixture.database.pool.query(
          "SELECT id FROM auth_user WHERE email = $1",
          [email],
        )
      ).rows,
    ).toEqual([]);
  });
  it("rejects oversized redirects before account lookup for both existing and unknown emails", async () => {
    const email = `${randomUUID()}@example.test`;
    expect(
      (
        await fixture.post("sign-up/email", {
          name: "Lee",
          email,
          password: "correct-horse-battery-staple-123",
        })
      ).statusCode,
    ).toBe(200);
    const before = await fixture.database.pool.query<{ count: string }>(
      "SELECT count(*) FROM auth_verification",
    );
    const oversized = [
      `${fixture.webOrigin}/${"x".repeat(5000)}`,
      `${fixture.webOrigin}/${"é".repeat(900)}`,
    ];
    for (const redirect of oversized) {
      for (const address of [email, `${randomUUID()}@example.test`]) {
        const reset = await fixture.post("request-password-reset", {
          email: address,
          redirectTo: redirect,
        });
        expect(reset.statusCode).toBe(400);
        const verification = await fixture.post("send-verification-email", {
          email: address,
          callbackURL: redirect,
        });
        expect(verification.statusCode).toBe(400);
      }
    }
    const after = await fixture.database.pool.query<{ count: string }>(
      "SELECT count(*) FROM auth_verification",
    );
    expect(after.rows).toEqual(before.rows);
    const tooLongEmail = `${"a".repeat(64)}@${"b".repeat(190)}.test`;
    expect(
      (await fixture.post("request-password-reset", { email: tooLongEmail }))
        .statusCode,
    ).toBe(400);
  });
});
