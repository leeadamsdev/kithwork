import { expect } from "vitest";
import { useTeamFixture } from "../teams/fixtures.js";
import type { Actor, Org } from "../organisations/fixtures.js";

export type Project = {
  id: string;
  organisationId: string;
  name: string;
  description: string | null;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  version: number;
  archivedAt: string | null;
  capabilities: {
    canEdit: boolean;
    canManageTeams: boolean;
    canArchive: boolean;
    canRestore: boolean;
  };
  teams: {
    id: string;
    name: string;
    key: string;
    visibility: string;
    archivedAt: string | null;
  }[];
};
export function useProjectFixture() {
  const teams = useTeamFixture();
  const { f } = teams;
  const query = (
    path: string,
    input: unknown,
    actor?: Actor,
    instance = f.app,
  ) => f.query(`organisations.projects.${path}`, input, actor, instance);
  const mutate = (
    path: string,
    input: unknown,
    actor?: Actor,
    instance = f.app,
  ) => f.mutate(`organisations.projects.${path}`, input, actor, instance);
  async function create(
    org: Org,
    teamIds: string[],
    actor = f.alice,
    extra = {},
  ) {
    const response = await mutate(
      "create",
      { organisationId: org.id, name: "Billing launch", teamIds, ...extra },
      actor,
    );
    expect(
      response.statusCode,
      [response.body, ...f.logLines.slice(-3)].join("\n"),
    ).toBe(200);
    return f.data<Project>(response);
  }
  return { f, teams, query, mutate, create };
}
