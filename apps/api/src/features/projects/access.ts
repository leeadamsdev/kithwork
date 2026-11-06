import type { ProjectTeam } from "@kithwork/contracts";
import { projectsSchema } from "@kithwork/database";
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import {
  actorTeamMember,
  organisationMember,
  team,
  teamMember,
  teamReadPredicate,
} from "../teams/access.js";

export const { project, projectTeam } = projectsSchema;
export const projectMemberJoin = (actorId: string) =>
  and(
    eq(organisationMember.organisationId, project.organisationId),
    eq(organisationMember.userId, actorId),
  );
export const projectTeamScope = () =>
  and(
    eq(projectTeam.organisationId, project.organisationId),
    eq(projectTeam.projectId, project.id),
  );

function relatedTeams(db: Database | Transaction, actorId: string) {
  return db
    .select({ id: team.id })
    .from(projectTeam)
    .innerJoin(
      team,
      and(
        eq(team.organisationId, projectTeam.organisationId),
        eq(team.id, projectTeam.teamId),
      ),
    )
    .leftJoin(
      actorTeamMember,
      and(
        eq(actorTeamMember.organisationId, team.organisationId),
        eq(actorTeamMember.teamId, team.id),
        eq(actorTeamMember.userId, actorId),
      ),
    );
}
export function projectReadPredicate(
  db: Database | Transaction,
  actorId: string,
) {
  return or(
    inArray(organisationMember.role, ["owner", "admin"]),
    exists(
      relatedTeams(db, actorId).where(
        and(projectTeamScope(), teamReadPredicate()),
      ),
    ),
  );
}
export function projectAccessFields(
  db: Database | Transaction,
  actorId: string,
) {
  const administrator = inArray(organisationMember.role, ["owner", "admin"]);
  const maintainedTeam = relatedTeams(db, actorId).where(
    and(projectTeamScope(), eq(actorTeamMember.role, "maintainer")),
  );
  const unmanagedTeam = relatedTeams(db, actorId).where(
    and(
      projectTeamScope(),
      or(isNull(actorTeamMember.role), ne(actorTeamMember.role, "maintainer")),
    ),
  );
  return {
    project,
    canEdit: sql<boolean>`${or(administrator, exists(maintainedTeam))}`,
    canManage: sql<boolean>`${or(administrator, and(exists(relatedTeams(db, actorId).where(projectTeamScope())), notExists(unmanagedTeam)))}`,
  };
}
export function visibleProjectTeams(actorId: string) {
  // Correlated with the project and membership in the outer query: one permission snapshot.
  return sql<ProjectTeam[]>`coalesce((select jsonb_agg(jsonb_build_object(
    'id', ${team.id}, 'name', ${team.name}, 'key', ${team.key},
    'visibility', ${team.visibility}, 'archivedAt', ${team.archivedAt}
  ) order by ${team.id}) from ${projectTeam}
  inner join ${team} on ${team.organisationId} = ${projectTeam.organisationId} and ${team.id} = ${projectTeam.teamId}
  left join ${teamMember} ${actorTeamMember} on ${actorTeamMember.organisationId} = ${team.organisationId} and ${actorTeamMember.teamId} = ${team.id} and ${actorTeamMember.userId} = ${actorId}
  where ${projectTeamScope()} and ${teamReadPredicate()}), '[]'::jsonb)`;
}
