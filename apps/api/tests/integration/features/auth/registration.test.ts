import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { integrationServices } from "../../../../../../tests/integration/context.js";
import { useAuthFixture } from "./fixtures.js";
describe("registration", () => {
  const fixture = useAuthFixture();
  it("resends verification mail without exposing existing accounts during signup", async () => {
    const email = `${randomUUID()}@example.test`;
    const payload = {
      email,
      name: "Lee",
      password: "correct-horse-battery-staple-123",
    };
    const first = await fixture.post("sign-up/email", payload);
    const duplicate = await fixture.post("sign-up/email", {
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
        await fixture.database.pool.query(
          "SELECT id FROM auth_user WHERE lower(email) = lower($1)",
          [email],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await fixture.post("send-verification-email", {
          email,
          callbackURL: fixture.webOrigin,
        })
      ).statusCode,
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
  it("delivers a maximum-length email and callback using the configured origin despite forged host headers", async () => {
    const email = `${randomUUID().replaceAll("-", "")}${"a".repeat(32)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(56)}.test`;
    expect(email).toHaveLength(254);
    const callbackBase = `${fixture.webOrigin}/`;
    const callbackURL =
      callbackBase + "x".repeat(2048 - encodeURIComponent(callbackBase).length);
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        origin: fixture.webOrigin,
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
    const link = await fixture.emailLink(email, "verify-email");
    expect(link.origin).toBe(fixture.baseURL);
    expect(link.href.length).toBeLessThanOrEqual(4096);
    const verified = await fixture.app.inject(link.pathname + link.search);
    expect(verified.statusCode).toBe(302);
    expect(verified.headers.location).toBe(callbackURL);
  });
});
