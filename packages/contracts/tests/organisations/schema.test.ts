import { describe, expect, it } from "vitest";
import {
  createOrganisationInputSchema,
  organisationRoleSchema,
  organisationPageInputSchema,
  changeMemberRoleInputSchema,
} from "../../src/organisations/schema.js";

describe("organisation contracts", () => {
  it("normalises bounded display names without accepting identity or role injection", () => {
    expect(
      createOrganisationInputSchema.parse({ name: "  Kithwork 工程  " }),
    ).toEqual({ name: "Kithwork 工程" });
    for (const input of [
      { name: " " },
      { name: "a".repeat(101) },
      { name: "Team", role: "owner" },
      { name: "Team", userId: "spoofed" },
    ]) {
      expect(createOrganisationInputSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });
  it("bounds pagination and validates cursor identities", () => {
    expect(organisationPageInputSchema.parse({})).toEqual({ limit: 50 });
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { cursor: "not-a-uuid" },
    ]) {
      expect(organisationPageInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("accepts only the three organisation roles and scoped role changes", () => {
    for (const role of ["owner", "admin", "member"])
      expect(organisationRoleSchema.parse(role)).toBe(role);
    expect(organisationRoleSchema.safeParse("superadmin").success).toBe(false);
    expect(
      changeMemberRoleInputSchema.safeParse({
        organisationId: "bad",
        userId: "bad",
        role: "owner",
      }).success,
    ).toBe(false);
  });
});
