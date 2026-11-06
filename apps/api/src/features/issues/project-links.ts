import { and, eq, exists, inArray } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { organisationMember } from "../teams/access.js";
import {
  project,
  projectTeam,
  projectMemberJoin,
  projectReadPredicate,
} from "../projects/access.js";
import { issueConflict, issueUnavailable } from "./errors.js";

export async function readVisibleIssueProjects(
  db: Database | Transaction,
  actorId: string,
  organisationId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  return db
    .select({
      id: project.id,
      name: project.name,
      archivedAt: project.archivedAt,
    })
    .from(project)
    .innerJoin(organisationMember, projectMemberJoin(actorId))
    .where(
      and(
        eq(project.organisationId, organisationId),
        inArray(project.id, ids),
        projectReadPredicate(db, actorId),
      ),
    );
}

export async function requireProjectLink(
  db: Transaction,
  actorId: string,
  input: { organisationId: string; teamId: string },
  projectId: string,
) {
  const [row] = await readVisibleIssueProjects(
    db,
    actorId,
    input.organisationId,
    [projectId],
  );
  if (!row) throw issueUnavailable();
  const [participating] = await db
    .select({ id: project.id })
    .from(project)
    .where(
      and(
        eq(project.organisationId, input.organisationId),
        eq(project.id, row.id),
        exists(
          db
            .select({ teamId: projectTeam.teamId })
            .from(projectTeam)
            .where(
              and(
                eq(projectTeam.organisationId, input.organisationId),
                eq(projectTeam.projectId, row.id),
                eq(projectTeam.teamId, input.teamId),
              ),
            ),
        ),
      ),
    );
  if (row.archivedAt || !participating)
    throw issueConflict("Choose an active project participating in this team");
  return row.id;
}
