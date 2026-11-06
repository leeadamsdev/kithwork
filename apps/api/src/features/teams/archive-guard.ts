import { projectsSchema } from "@kithwork/database";
import { and, eq, isNull, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Transaction } from "../../platform/database/types.js";
import { team } from "./access.js";
import { teamConflict } from "./errors.js";

const { project, projectTeam } = projectsSchema;
const otherAssociation = alias(projectTeam, "other_project_team");
const otherTeam = alias(team, "other_team");
export async function requireSafeTeamArchive(
  tx: Transaction,
  organisationId: string,
  teamId: string,
) {
  const [blocked] = await tx
    .select({ id: project.id })
    .from(project)
    .innerJoin(
      projectTeam,
      and(
        eq(projectTeam.organisationId, project.organisationId),
        eq(projectTeam.projectId, project.id),
      ),
    )
    .where(
      and(
        eq(project.organisationId, organisationId),
        eq(projectTeam.teamId, teamId),
        isNull(project.archivedAt),
        notExists(
          tx
            .select({ id: otherTeam.id })
            .from(otherAssociation)
            .innerJoin(
              otherTeam,
              and(
                eq(otherTeam.organisationId, otherAssociation.organisationId),
                eq(otherTeam.id, otherAssociation.teamId),
              ),
            )
            .where(
              and(
                eq(otherAssociation.organisationId, organisationId),
                eq(otherAssociation.projectId, project.id),
                ne(otherTeam.id, teamId),
                isNull(otherTeam.archivedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(project.id)
    .limit(1)
    .for("update", { of: project });
  if (blocked)
    throw teamConflict("Team is the last active team of an unarchived project");
}
