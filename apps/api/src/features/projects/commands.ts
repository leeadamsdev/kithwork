import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "@kithwork/contracts";
import { TRPCError } from "@trpc/server";
import type { Database } from "../../platform/database/types.js";
import { withLockedOrganisation } from "../organisations/transaction.js";
import { project, projectTeam } from "./access.js";
import { projectForbidden } from "./errors.js";
import { canEditProject } from "./policies.js";
import { getProject } from "./queries.js";
import {
  lockProjectTeams,
  requireProjectCreator,
  requireSelectedTeams,
} from "./team-access.js";
import {
  requireActiveProject,
  requireProjectVersion,
  saveProject,
  withLockedProject,
} from "./transaction.js";

export function createProject(
  db: Database,
  actorId: string,
  input: CreateProjectInput,
) {
  return withLockedOrganisation(
    db,
    actorId,
    input.organisationId,
    async (tx, organisation) => {
      await requireProjectCreator(
        tx,
        actorId,
        input.organisationId,
        organisation.role,
      );
      const teams = await lockProjectTeams(
        tx,
        actorId,
        input.organisationId,
        input.teamIds,
      );
      requireSelectedTeams(teams, input.teamIds, [], organisation.role);
      const { teamIds, ...values } = input;
      const [row] = await tx.insert(project).values(values).returning();
      await tx.insert(projectTeam).values(
        teamIds.map((teamId) => ({
          organisationId: input.organisationId,
          projectId: row!.id,
          teamId,
        })),
      );
      return getProject(tx, actorId, {
        organisationId: input.organisationId,
        projectId: row!.id,
      });
    },
  );
}
export function updateProject(
  db: Database,
  actorId: string,
  input: UpdateProjectInput,
) {
  return withLockedProject(db, actorId, input, [], async (tx, access) => {
    if (
      !canEditProject(
        access.organisationRole,
        access.teams.map((row) => row.role),
      )
    )
      throw projectForbidden();
    requireActiveProject(access.project);
    requireProjectVersion(access.project, input.expectedVersion);
    const row = access.project;
    const values = {
      name: input.name ?? row.name,
      description:
        input.description === undefined ? row.description : input.description,
      status: input.status ?? row.status,
      startDate:
        input.startDate === undefined ? row.startDate : input.startDate,
      targetDate:
        input.targetDate === undefined ? row.targetDate : input.targetDate,
    };
    if (
      values.startDate &&
      values.targetDate &&
      values.targetDate < values.startDate
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Target date must not precede start date",
      });
    if (
      values.name !== row.name ||
      values.description !== row.description ||
      values.status !== row.status ||
      values.startDate !== row.startDate ||
      values.targetDate !== row.targetDate
    )
      await saveProject(tx, row, values);
    return getProject(tx, actorId, input);
  });
}
