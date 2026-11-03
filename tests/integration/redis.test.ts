import { describe, expect, it } from "vitest";
import { redisFixture } from "./fixtures.js";

describe("Redis infrastructure", () => {
  const first = redisFixture();
  const second = redisFixture();

  it("connects and isolates identically named keys between namespaces", async () => {
    expect(await first.client().ping()).toBe("PONG");
    await first.client().set(first.key("shared-name"), "first");
    await second.client().set(second.key("shared-name"), "second");
    expect(await first.client().get(first.key("shared-name"))).toBe("first");
    expect(await second.client().get(second.key("shared-name"))).toBe("second");
  });

  it("uses queue-compatible eviction and persistence settings", async () => {
    expect(await first.client().config("GET", "maxmemory-policy")).toEqual([
      "maxmemory-policy",
      "noeviction",
    ]);
    expect(await first.client().config("GET", "appendonly")).toEqual([
      "appendonly",
      "yes",
    ]);
  });
});
