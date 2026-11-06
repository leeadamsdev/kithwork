import { describe, expect, it } from "vitest";
import {
  canReadTeam,
  canManageTeam,
  isOrganisationAdministrator,
} from "../../../../src/features/teams/policies.js";

describe("team permissions", () => {
  for (const organisationRole of ["owner", "admin", "member"] as const) {
    for (const membershipRole of [null, "member", "maintainer"] as const) {
      it(`${organisationRole}/${membershipRole ?? "non-member"} respects private visibility and delegated management`, () => {
        const administrator = organisationRole !== "member";
        expect(isOrganisationAdministrator(organisationRole)).toBe(
          administrator,
        );
        expect(
          canReadTeam(organisationRole, "organisation", membershipRole),
        ).toBe(true);
        expect(canReadTeam(organisationRole, "private", membershipRole)).toBe(
          administrator || membershipRole !== null,
        );
        expect(canManageTeam(organisationRole, membershipRole)).toBe(
          administrator || membershipRole === "maintainer",
        );
      });
    }
  }
});
