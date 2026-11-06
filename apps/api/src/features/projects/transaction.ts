import { and, eq, sql } from "drizzle-orm";
import type { VersionedProjectInput } from "@kithwork/contracts";
import type { Database, Transaction } from "../../platform/database/types.js";
import { withLockedOrganisation } from "../organisations/transaction.js";
import { canReadTeam, isOrganisationAdministrator } from "../teams/policies.js";
import { project, projectTeam } from "./access.js";
import { projectConflict, projectUnavailable } from "./errors.js";
import { lockProjectTeams, type LockedProjectTeams } from "./team-access.js";
import type { ProjectRow } from "./presentation.js";
import type { OrganisationRole } from "@kithwork/contracts";

export function withLockedProject<T>(
  db: Database,
  actorId: string,
  input: VersionedProjectInput,
  extraTeamIds: string[],
  action: (
    tx: Transaction,
    access: {
      project: ProjectRow;
      organisationRole: OrganisationRole;
      teams: LockedProjectTeams;
      currentIds: string[];
    },
  ) => Promise<T>,
) {
  return withLockedOrganisation(
    db,
    actorId,
    input.organisationId,
    async (tx, organisation) => {
      const associations = await tx
        .select({ id: projectTeam.teamId })
        .from(projectTeam)
        .where(
          and(
            eq(projectTeam.organisationId, input.organisationId),
            eq(projectTeam.projectId, input.projectId),
          ),
        );
      const currentIds = associations.map((row) => row.id);
      // Organisation -> all affected teams in UUID order -> project. All administration writers share this order.
      const teams = await lockProjectTeams(tx, actorId, input.organisationId, [
        ...new Set([...currentIds, ...extraTeamIds]),
      ]);
      const [row] = await tx
        .select()
        .from(project)
        .where(
          and(
            eq(project.organisationId, input.organisationId),
            eq(project.id, input.projectId),
          ),
        )
        .for("update");
      if (
        !row ||
        (!isOrganisationAdministrator(organisation.role) &&
          !teams.some(
            (value) =>
              currentIds.includes(value.team.id) &&
              canReadTeam(organisation.role, value.team.visibility, value.role),
          ))
      )
        throw projectUnavailable();
      return action(tx, {
        project: row,
        organisationRole: organisation.role,
        teams,
        currentIds,
      });
    },
  );
}
export function requireActiveProject(row: ProjectRow) {
  if (row.archivedAt)
    throw projectConflict("Restore this project before changing it");
}
export function requireProjectVersion(
  row: ProjectRow,
  expectedVersion: number,
) {
  if (row.version !== expectedVersion)
    throw projectConflict("Project has changed; refresh and retry");
}
export async function saveProject(
  tx: Transaction,
  row: ProjectRow,
  values: Partial<
    Pick<
      ProjectRow,
      | "name"
      | "description"
      | "status"
      | "startDate"
      | "targetDate"
      | "archivedAt"
    >
  >,
) {
  await tx
    .update(project)
    .set({
      ...values,
      version: sql`${project.version}+1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(project.organisationId, row.organisationId),
        eq(project.id, row.id),
      ),
    );
}
