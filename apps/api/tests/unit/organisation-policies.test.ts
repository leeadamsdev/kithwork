import { expect, it } from "vitest";
import {
  canUpdateOrganisation,
  canChangeMemberRole,
  canRemoveMember,
} from "../../src/organisations/policies.js";

it.each([
  ["owner", true, true],
  ["admin", true, false],
  ["member", false, false],
] as const)(
  "limits %s organisation administration",
  (role, update, changeRole) => {
    expect(canUpdateOrganisation(role)).toBe(update);
    expect(canChangeMemberRole(role)).toBe(changeRole);
  },
);
it.each([
  ["owner", "owner", true],
  ["owner", "admin", true],
  ["owner", "member", true],
  ["admin", "owner", false],
  ["admin", "admin", false],
  ["admin", "member", true],
  ["member", "owner", false],
  ["member", "admin", false],
  ["member", "member", false],
] as const)("checks %s removal of %s", (actor, target, allowed) => {
  expect(canRemoveMember(actor, target)).toBe(allowed);
});
