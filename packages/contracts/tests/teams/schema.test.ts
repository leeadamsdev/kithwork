import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createTeamInputSchema,
  updateTeamInputSchema,
  teamPageInputSchema,
  addTeamMemberInputSchema,
  setTeamVisibilityInputSchema,
} from "../../src/teams/inputs.js";
import { teamRoleSchema } from "../../src/teams/schema.js";

describe("team inputs", () => {
  const organisationId = randomUUID();
  const teamId = randomUUID();
  it("normalises team keys and names and supplies explicit defaults", () => {
    expect(
      createTeamInputSchema.parse({
        organisationId,
        name: " Backend ",
        key: " eng ",
      }),
    ).toEqual({
      organisationId,
      name: "Backend",
      key: "ENG",
      description: null,
      visibility: "organisation",
    });
    expect(teamPageInputSchema.parse({ organisationId })).toEqual({
      organisationId,
      scope: "all",
      archived: "exclude",
      limit: 50,
    });
  });
  it("rejects invalid or ambiguous keys and overlong metadata", () => {
    for (const key of ["A", "1ENG", "ENG-API", "LONGERTHAN10"])
      expect(
        createTeamInputSchema.safeParse({
          organisationId,
          name: "Backend",
          key,
        }).success,
      ).toBe(false);
    expect(
      createTeamInputSchema.safeParse({ organisationId, name: " ", key: "ENG" })
        .success,
    ).toBe(false);
    expect(
      createTeamInputSchema.safeParse({
        organisationId,
        name: "Backend",
        key: "ENG",
        description: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });
  it("requires a real versioned patch and separates privacy from metadata", () => {
    const input = { organisationId, teamId, expectedVersion: 1 };
    expect(updateTeamInputSchema.safeParse(input).success).toBe(false);
    for (const extra of [
      { key: "NEW" },
      { visibility: "private" },
      { archivedAt: null },
    ])
      expect(
        updateTeamInputSchema.safeParse({ ...input, name: "New", ...extra })
          .success,
      ).toBe(false);
    expect(
      updateTeamInputSchema.parse({ ...input, description: " " }).description,
    ).toBeNull();
    expect(
      setTeamVisibilityInputSchema.safeParse({
        ...input,
        visibility: "private",
      }).success,
    ).toBe(true);
    for (const expectedVersion of [0, -1, 1.5, 2147483648])
      expect(
        updateTeamInputSchema.safeParse({
          ...input,
          name: "New",
          expectedVersion,
        }).success,
      ).toBe(false);
  });
  it("keeps team roles scoped and pages bounded", () => {
    expect(teamRoleSchema.safeParse("admin").success).toBe(false);
    expect(
      addTeamMemberInputSchema.parse({
        organisationId,
        teamId,
        userId: randomUUID(),
      }).role,
    ).toBe("member");
    for (const limit of [0, 101])
      expect(
        teamPageInputSchema.safeParse({ organisationId, limit }).success,
      ).toBe(false);
  });
});
