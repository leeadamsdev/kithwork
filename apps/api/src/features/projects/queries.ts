import type { ProjectPageInput } from "@kithwork/contracts";
import { and, eq, exists, gt, isNotNull, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import {
  readTeamAccess,
  team,
  selectTeamAccess,
  teamReadPredicate,
  organisationMember,
} from "../teams/access.js";
import {
  project,
  projectTeam,
  projectAccessFields,
  projectMemberJoin,
  projectReadPredicate,
  projectTeamScope,
  visibleProjectTeams,
} from "./access.js";
import { projectUnavailable } from "./errors.js";
import { presentProject } from "./presentation.js";

export async function getProject(
  db: Database | Transaction,
  actorId: string,
  input: { organisationId: string; projectId: string },
) {
  const [row] = await db
    .select({
      ...projectAccessFields(db, actorId),
      teams: visibleProjectTeams(actorId),
    })
    .from(project)
    .innerJoin(organisationMember, projectMemberJoin(actorId))
    .where(
      and(
        eq(project.organisationId, input.organisationId),
        eq(project.id, input.projectId),
        projectReadPredicate(db, actorId),
      ),
    );
  if (!row) throw projectUnavailable();
  return {
    ...presentProject(row.project, row.canEdit, row.canManage),
    teams: row.teams.map((value) => ({
      ...value,
      archivedAt:
        value.archivedAt === null
          ? null
          : new Date(value.archivedAt).toISOString(),
    })),
  };
}
export async function listProjects(
  db: Database,
  actorId: string,
  input: ProjectPageInput,
) {
  if (input.teamId)
    await readTeamAccess(db, actorId, input.organisationId, input.teamId);
  const rows = await db
    .select(projectAccessFields(db, actorId))
    .from(project)
    .innerJoin(organisationMember, projectMemberJoin(actorId))
    .where(
      and(
        eq(project.organisationId, input.organisationId),
        projectReadPredicate(db, actorId),
        input.archived === "exclude"
          ? isNull(project.archivedAt)
          : input.archived === "only"
            ? isNotNull(project.archivedAt)
            : undefined,
        input.status ? eq(project.status, input.status) : undefined,
        input.cursor ? gt(project.id, input.cursor) : undefined,
        input.teamId
          ? exists(
              db
                .select({ id: projectTeam.teamId })
                .from(projectTeam)
                .where(
                  and(projectTeamScope(), eq(projectTeam.teamId, input.teamId)),
                ),
            )
          : undefined,
        // Repeat team visibility in the data query if membership/privacy changes after the filter precheck.
        input.teamId
          ? exists(
              selectTeamAccess(db, actorId).where(
                and(
                  eq(team.organisationId, input.organisationId),
                  eq(team.id, input.teamId),
                  teamReadPredicate(),
                ),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(project.id)
    .limit(input.limit + 1);
  const items = rows
    .slice(0, input.limit)
    .map((row) => presentProject(row.project, row.canEdit, row.canManage));
  return {
    items,
    nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
  };
}
