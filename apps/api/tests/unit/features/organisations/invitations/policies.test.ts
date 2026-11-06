import { describe, expect, it } from "vitest";
import {
  canManageInvitations,
  canGrantInvitation,
} from "../../../../../src/features/organisations/invitations/policies.js";

describe("invitation permissions", () => {
  it.each([
    ["owner", true, true],
    ["admin", true, false],
    ["member", false, false],
  ] as const)("limits grants for %s", (role, member, admin) => {
    expect(canManageInvitations(role)).toBe(role !== "member");
    expect(canGrantInvitation(role, "member")).toBe(member);
    expect(canGrantInvitation(role, "admin")).toBe(admin);
  });
});
