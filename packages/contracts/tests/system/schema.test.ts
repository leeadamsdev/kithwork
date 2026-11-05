import { expect, it } from "vitest";
import { systemInfoSchema } from "../../src/system/schema.js";

it("validates the public API metadata contract", () => {
  expect(
    systemInfoSchema.safeParse({ name: "kithwork-api", version: "0.0.0" })
      .success,
  ).toBe(true);
  expect(
    systemInfoSchema.safeParse({ name: "another-api", version: "0.0.0" })
      .success,
  ).toBe(false);
  expect(
    systemInfoSchema.safeParse({ name: "kithwork-api", version: "" }).success,
  ).toBe(false);
});
