import type { CreateTeamInput, UpdateTeamInput } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { withLockedOrganisation } from "../organisations/transaction.js";
import { team, teamMember } from "./access.js";
import { canManageTeam, isOrganisationAdministrator } from "./policies.js";
import { teamConflict, teamForbidden } from "./errors.js";
import { presentTeam } from "./presentation.js";
import { initialiseTeamWorkflow } from "../workflows/bootstrap.js";
import {
  requireActiveTeam,
  requireTeamVersion,
  saveTeam,
  withLockedTeam,
} from "./transaction.js";

export function createTeam(
  db: Database,
  actorId: string,
  input: CreateTeamInput,
) {
  return withLockedOrganisation(
    db,
    actorId,
    input.organisationId,
    async (tx, organisation) => {
      if (!isOrganisationAdministrator(organisation.role))
        throw teamForbidden();
      const [row] = await tx
        .insert(team)
        .values(input)
        .onConflictDoNothing({ target: [team.organisationId, team.key] })
        .returning();
      if (!row) throw teamConflict("Team key is already in use");
      await tx.insert(teamMember).values({
        organisationId: row.organisationId,
        teamId: row.id,
        userId: actorId,
        role: "maintainer",
      });
      await initialiseTeamWorkflow(tx, row.organisationId, row.id);
      return presentTeam(row, organisation.role, "maintainer");
    },
  );
}
export function updateTeam(
  db: Database,
  actorId: string,
  input: UpdateTeamInput,
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    if (!canManageTeam(access.organisationRole, access.membershipRole))
      throw teamForbidden();
    requireActiveTeam(access.team);
    requireTeamVersion(access.team, input.expectedVersion);
    const name = input.name ?? access.team.name;
    const description =
      input.description === undefined
        ? access.team.description
        : input.description;
    const row =
      name === access.team.name && description === access.team.description
        ? access.team
        : await saveTeam(tx, access.team, { name, description });
    return presentTeam(row, access.organisationRole, access.membershipRole);
  });
}
