import type { TeamVisibility } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { isOrganisationAdministrator } from "./policies.js";
import { teamForbidden } from "./errors.js";
import { presentTeam } from "./presentation.js";
import { requireSafeTeamArchive } from "./archive-guard.js";
import { clearIssueAssignments } from "../issues/assignment-cleanup.js";
import {
  requireActiveTeam,
  requireTeamVersion,
  saveTeam,
  withLockedTeam,
} from "./transaction.js";

type Input = {
  organisationId: string;
  teamId: string;
  expectedVersion: number;
};
export function setTeamVisibility(
  db: Database,
  actorId: string,
  input: Input & { visibility: TeamVisibility },
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    if (!isOrganisationAdministrator(access.organisationRole))
      throw teamForbidden();
    requireActiveTeam(access.team);
    requireTeamVersion(access.team, input.expectedVersion);
    const row =
      access.team.visibility === input.visibility
        ? access.team
        : await saveTeam(tx, access.team, { visibility: input.visibility });
    if (
      access.team.visibility !== input.visibility &&
      input.visibility === "private"
    )
      await clearIssueAssignments(
        tx,
        actorId,
        input,
        "team_visibility_changed",
      );
    return presentTeam(row, access.organisationRole, access.membershipRole);
  });
}
export function setTeamArchived(
  db: Database,
  actorId: string,
  input: Input,
  archived: boolean,
) {
  return withLockedTeam(db, actorId, input, async (tx, access) => {
    if (!isOrganisationAdministrator(access.organisationRole))
      throw teamForbidden();
    if ((access.team.archivedAt !== null) === archived)
      return presentTeam(
        access.team,
        access.organisationRole,
        access.membershipRole,
      );
    requireTeamVersion(access.team, input.expectedVersion);
    if (archived)
      await requireSafeTeamArchive(tx, input.organisationId, input.teamId);
    const row = await saveTeam(tx, access.team, {
      archivedAt: archived ? new Date() : null,
    });
    return presentTeam(row, access.organisationRole, access.membershipRole);
  });
}
