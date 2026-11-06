import { expect } from "vitest";
import type { Workflow } from "@kithwork/contracts";
import { useTeamFixture } from "../teams/fixtures.js";
import type { Actor } from "../organisations/fixtures.js";

export function useWorkflowFixture() {
  const teams = useTeamFixture();
  const { f } = teams;
  const query = (path: string, input: unknown, actor?: Actor) =>
    f.query(`organisations.teams.workflow.${path}`, input, actor);
  const mutate = (path: string, input: unknown, actor?: Actor) =>
    f.mutate(`organisations.teams.workflow.statuses.${path}`, input, actor);
  async function get(
    input: { organisationId: string; teamId: string },
    actor = f.alice,
  ) {
    const response = await query("get", input, actor);
    expect(
      response.statusCode,
      [response.body, ...f.logLines.slice(-3)].join("\n"),
    ).toBe(200);
    return f.data<Workflow>(response);
  }
  async function change(path: string, input: unknown, actor = f.alice) {
    const response = await mutate(path, input, actor);
    expect(
      response.statusCode,
      [response.body, ...f.logLines.slice(-3)].join("\n"),
    ).toBe(200);
    return f.data<Workflow>(response);
  }
  return { f, teams, query, mutate, get, change };
}
