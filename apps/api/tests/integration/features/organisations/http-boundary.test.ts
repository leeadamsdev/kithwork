import { describe, expect, it } from "vitest";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../src/app.js";
import { useOrganisationFixture } from "./fixtures.js";
describe("http boundary", () => {
  const fixture = useOrganisationFixture();
  it("rejects untrusted or missing origins and non-JSON mutation bodies before writing", async () => {
    for (const origin of [
      undefined,
      "null",
      "https://attacker.test",
      `${fixture.webOrigin}.attacker.test`,
    ]) {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/trpc/organisations.create",
        headers: {
          cookie: fixture.alice.cookie,
          ...(origin ? { origin } : {}),
          host: "attacker.test",
          "x-forwarded-host": "app.kithwork.test",
        },
        payload: { name: "Forbidden origin" },
      });
      expect(response.statusCode).toBe(403);
    }
    const plain = await fixture.app.inject({
      method: "POST",
      url: "/trpc/organisations.create",
      headers: {
        cookie: fixture.alice.cookie,
        origin: fixture.webOrigin,
        "content-type": "text/plain",
      },
      payload: '{"name":"Plain text"}',
    });
    expect(plain.statusCode).toBe(415);
    expect(
      (
        await fixture.database.pool.query(
          "SELECT id FROM organisation WHERE name IN ('Forbidden origin','Plain text')",
        )
      ).rows,
    ).toEqual([]);
    const ownOrigin = await fixture.app.inject({
      method: "POST",
      url: "/trpc/organisations.create",
      headers: {
        cookie: fixture.alice.cookie,
        origin: "https://api.kithwork.test",
        "content-type": "application/json; charset=utf-8",
      },
      payload: JSON.stringify({ name: "API origin" }),
    });
    expect(ownOrigin.statusCode).toBe(200);
  });
  it("counts each batched creation per user across API instances without sharing other users' buckets", async () => {
    const options = fixture.config({
      API_ORGANISATION_CREATION_RATE_LIMIT_MAX: "2",
    });
    const first = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    const second = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    try {
      await Promise.all([first.ready(), second.ready()]);
      await fixture.create(fixture.alice, "First limited creation", first);
      const response = await second.inject({
        method: "POST",
        url: "/trpc/organisations.create,organisations.create?batch=1",
        headers: { cookie: fixture.alice.cookie, origin: fixture.webOrigin },
        payload: {
          0: { name: "Second limited creation" },
          1: { name: "Third limited creation" },
        },
      });
      expect(response.statusCode).toBe(207);
      const items =
        response.json<
          { error?: { data: { httpStatus: number } }; result?: unknown }[]
        >();
      expect(items.filter((item) => item.result)).toHaveLength(1);
      expect(items.find((item) => item.error)?.error?.data.httpStatus).toBe(
        429,
      );
      expect(
        (
          await fixture.mutate(
            "organisations.create",
            { name: "Fourth limited creation" },
            fixture.alice,
            first,
          )
        ).statusCode,
      ).toBe(429);
      await fixture.create(fixture.bob, "Independent user", second);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
