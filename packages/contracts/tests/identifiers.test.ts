import { describe, expect, expectTypeOf, it } from "vitest";
import { entityIdSchema, type EntityId } from "../src/index.js";

describe("entity identifiers", () => {
  it.each([
    "550e8400-e29b-41d4-a716-446655440000",
    "01932f90-7d3b-7c5a-9b2f-876543210abc",
    "550E8400-E29B-41D4-A716-446655440000",
  ])("accepts a UUID without changing it: %s", (identifier) => {
    expect(entityIdSchema.parse(identifier)).toBe(identifier);
  });

  it.each([
    "",
    "not-an-identifier",
    "550e8400e29b41d4a716446655440000",
    "550e8400-e29b-41d4-1716-446655440000",
    " 550e8400-e29b-41d4-a716-446655440000 ",
    42,
    null,
    undefined,
  ])("rejects invalid input without coercion: %j", (input) => {
    expect(entityIdSchema.safeParse(input).success).toBe(false);
  });

  it("distinguishes a validated identifier from an unvalidated string", () => {
    const identifier = entityIdSchema.parse(
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expectTypeOf(identifier).toEqualTypeOf<EntityId>();
    expectTypeOf<EntityId>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<EntityId>();
  });
});
