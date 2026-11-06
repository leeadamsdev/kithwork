import { expect } from "vitest";
import type { IssueDetail } from "@kithwork/contracts";
import { useTeamFixture } from "../teams/fixtures.js";
import type { Actor } from "../organisations/fixtures.js";

export function useIssueFixture() {
  const teams = useTeamFixture();
  const { f } = teams;
  const query = (path: string, input: unknown, actor?: Actor) =>
    f.query(`organisations.issues.${path}`, input, actor);
  const mutate = (path: string, input: unknown, actor?: Actor) =>
    f.mutate(`organisations.issues.${path}`, input, actor);
  async function create(
    scope: { organisationId: string; teamId: string },
    fields: Record<string, unknown> = {},
    actor = f.alice,
  ) {
    const response = await mutate(
      "create",
      { ...scope, title: "Fix race", ...fields },
      actor,
    );
    expect(
      response.statusCode,
      [response.body, ...f.logLines.slice(-3)].join("\n"),
    ).toBe(200);
    return f.data<IssueDetail>(response);
  }
  async function get(
    input: { organisationId: string; issueId: string },
    actor = f.alice,
  ) {
    const response = await query(
      "get",
      { organisationId: input.organisationId, issueId: input.issueId },
      actor,
    );
    expect(response.statusCode, response.body).toBe(200);
    return f.data<IssueDetail>(response);
  }
  return { f, teams, query, mutate, create, get };
}
