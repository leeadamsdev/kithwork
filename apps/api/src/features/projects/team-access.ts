import { and, eq, inArray, isNull } from "drizzle-orm";
import type { OrganisationRole } from "@kithwork/contracts";
import type { Database, Transaction } from "../../platform/database/types.js";
import { actorTeamMember, team, teamMember } from "../teams/access.js";
import { canReadTeam, isOrganisationAdministrator } from "../teams/policies.js";
import { projectTeam } from "./access.js";
import { canManageProject } from "./policies.js";
import {
  projectConflict,
  projectForbidden,
  projectUnavailable,
} from "./errors.js";

export async function requireProjectCreator(
  db: Database | Transaction,
  actorId: string,
  organisationId: string,
  role: OrganisationRole,
) {
  if (isOrganisationAdministrator(role)) return;
  const [membership] = await db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.organisationId, organisationId),
        eq(teamMember.userId, actorId),
        eq(teamMember.role, "maintainer"),
      ),
    )
    .limit(1);
  if (!membership) throw projectForbidden();
}
export async function lockProjectTeams(
  tx: Transaction,
  actorId: string,
  organisationId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  return tx
    .select({ team, role: actorTeamMember.role })
    .from(team)
    .leftJoin(
      actorTeamMember,
      and(
        eq(actorTeamMember.organisationId, team.organisationId),
        eq(actorTeamMember.teamId, team.id),
        eq(actorTeamMember.userId, actorId),
      ),
    )
    .where(and(eq(team.organisationId, organisationId), inArray(team.id, ids)))
    .orderBy(team.id)
    .for("update", { of: team });
}
export type LockedProjectTeams = Awaited<ReturnType<typeof lockProjectTeams>>;
export function requireSelectedTeams(
  rows: LockedProjectTeams,
  desiredIds: string[],
  currentIds: string[],
  organisationRole: OrganisationRole,
) {
  const selected = desiredIds.map((id) => {
    const row = rows.find((value) => value.team.id === id);
    if (!row || !canReadTeam(organisationRole, row.team.visibility, row.role))
      throw projectUnavailable();
    return row;
  });
  if (
    !canManageProject(
      organisationRole,
      selected.map((row) => row.role),
    )
  )
    throw projectForbidden();
  if (
    selected.some(
      (row) =>
        row.team.archivedAt !== null && !currentIds.includes(row.team.id),
    )
  )
    throw projectConflict("New project associations require active teams");
  if (!selected.some((row) => row.team.archivedAt === null))
    throw projectConflict("A project requires an active team");
}
export async function requireActiveProjectTeam(
  tx: Transaction,
  organisationId: string,
  projectId: string,
) {
  const [active] = await tx
    .select({ id: team.id })
    .from(projectTeam)
    .innerJoin(
      team,
      and(
        eq(team.organisationId, projectTeam.organisationId),
        eq(team.id, projectTeam.teamId),
      ),
    )
    .where(
      and(
        eq(projectTeam.organisationId, organisationId),
        eq(projectTeam.projectId, projectId),
        isNull(team.archivedAt),
      ),
    )
    .limit(1);
  if (!active)
    throw projectConflict(
      "Restore a participating team before restoring this project",
    );
}
