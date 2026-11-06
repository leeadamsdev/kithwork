import { expect } from "vitest";
import type { Team } from "@kithwork/contracts";
import {
  useOrganisationFixture,
  type Actor,
  type Org,
} from "../organisations/fixtures.js";

export function useTeamFixture() {
  const f = useOrganisationFixture();
  const query = (
    path: string,
    input: unknown,
    actor?: Actor,
    instance = f.app,
  ) => f.query(`organisations.teams.${path}`, input, actor, instance);
  const mutate = (
    path: string,
    input: unknown,
    actor?: Actor,
    instance = f.app,
  ) => f.mutate(`organisations.teams.${path}`, input, actor, instance);
  async function create(
    org: Org,
    input: { key?: string; visibility?: "organisation" | "private" } = {},
    actor = f.alice,
  ) {
    const response = await mutate(
      "create",
      { organisationId: org.id, name: "Backend", key: "ENG", ...input },
      actor,
    );
    expect(response.statusCode, response.body).toBe(200);
    return f.data<Team>(response);
  }
  return { f, query, mutate, create };
}
