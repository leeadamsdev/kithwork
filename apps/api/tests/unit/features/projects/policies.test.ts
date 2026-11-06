import { expect, it } from "vitest";
import type { OrganisationRole, TeamRole } from "@kithwork/contracts";
import {
  canEditProject,
  canManageProject,
} from "../../../../src/features/projects/policies.js";

it.each<{
  org: OrganisationRole;
  teams: (TeamRole | null)[];
  edit: boolean;
  manage: boolean;
}>([
  { org: "owner", teams: [null, null], edit: true, manage: true },
  { org: "admin", teams: [null], edit: true, manage: true },
  { org: "member", teams: ["maintainer"], edit: true, manage: true },
  {
    org: "member",
    teams: ["maintainer", "maintainer"],
    edit: true,
    manage: true,
  },
  { org: "member", teams: ["maintainer", "member"], edit: true, manage: false },
  { org: "member", teams: ["maintainer", null], edit: true, manage: false },
  { org: "member", teams: ["member"], edit: false, manage: false },
  { org: "member", teams: [null], edit: false, manage: false },
  { org: "member", teams: [], edit: false, manage: false },
])(
  "applies project rights to $org and $teams",
  ({ org, teams, edit, manage }) => {
    expect(canEditProject(org, teams)).toBe(edit);
    expect(canManageProject(org, teams)).toBe(manage);
  },
);
