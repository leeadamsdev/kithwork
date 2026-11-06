import { encodeIssueCursor, type IssueListInput } from "@kithwork/contracts";
import { and, desc, eq, isNull, isNotNull, lt, or } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { team, teamReadPredicate, readTeamAccess } from "../teams/access.js";
import {
  issue,
  readIssueAccess,
  readStatusAccess,
  selectIssueAccess,
  workflowStatus,
  type IssueScope,
} from "./access.js";
import { issueUnavailable } from "./errors.js";
import { presentIssue, presentIssueSummary } from "./presentation.js";
import { requireAssigneeFilter } from "./assignees.js";
import { readVisibleIssueProjects } from "./project-links.js";

export async function getIssue(
  db: Database | Transaction,
  actorId: string,
  input: IssueScope,
) {
  return presentIssue(await readIssueAccess(db, actorId, input));
}
export async function getIssueByIdentifier(
  db: Database,
  actorId: string,
  input: { organisationId: string; identifier: string },
) {
  const split = input.identifier.lastIndexOf("-");
  const [row] = await selectIssueAccess(db, actorId).where(
    and(
      eq(issue.organisationId, input.organisationId),
      eq(team.key, input.identifier.slice(0, split)),
      eq(issue.number, Number(input.identifier.slice(split + 1))),
      teamReadPredicate(),
    ),
  );
  if (!row) throw issueUnavailable();
  return presentIssue(row);
}
export async function listIssues(
  db: Database,
  actorId: string,
  input: IssueListInput,
) {
  if (input.teamId)
    await readTeamAccess(db, actorId, input.organisationId, input.teamId);
  if (input.statusId)
    await readStatusAccess(db, actorId, input.organisationId, input.statusId);
  if (input.assigneeId)
    await requireAssigneeFilter(db, input.organisationId, input.assigneeId);
  if (
    input.projectId &&
    !(
      await readVisibleIssueProjects(db, actorId, input.organisationId, [
        input.projectId,
      ])
    ).length
  )
    throw issueUnavailable();
  const rows = await selectIssueAccess(db, actorId)
    .where(
      and(
        eq(issue.organisationId, input.organisationId),
        teamReadPredicate(),
        input.teamId ? eq(issue.teamId, input.teamId) : undefined,
        input.statusId ? eq(issue.statusId, input.statusId) : undefined,
        input.assigneeId ? eq(issue.assigneeId, input.assigneeId) : undefined,
        input.projectId ? eq(issue.projectId, input.projectId) : undefined,
        input.category
          ? eq(workflowStatus.category, input.category)
          : undefined,
        input.priority ? eq(issue.priority, input.priority) : undefined,
        input.archived === "exclude"
          ? isNull(issue.archivedAt)
          : input.archived === "only"
            ? isNotNull(issue.archivedAt)
            : undefined,
        input.includeArchivedTeams ? undefined : isNull(team.archivedAt),
        input.cursor
          ? or(
              lt(issue.createdAt, new Date(input.cursor.createdAt)),
              and(
                eq(issue.createdAt, new Date(input.cursor.createdAt)),
                lt(issue.id, input.cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(issue.createdAt), desc(issue.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map(presentIssueSummary);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > input.limit && last
        ? encodeIssueCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}
