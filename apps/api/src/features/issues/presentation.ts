import { canManageTeam } from "../teams/policies.js";
import type { IssueAccess } from "./access.js";

export function presentIssueSummary(row: IssueAccess) {
  const value = row.issue,
    activeTeam = row.team.archivedAt === null;
  const manage = canManageTeam(row.organisationRole, row.membershipRole);
  return {
    id: value.id,
    organisationId: value.organisationId,
    teamId: value.teamId,
    number: value.number,
    identifier: `${row.team.key}-${value.number}`,
    title: value.title,
    statusId: value.statusId,
    status: {
      ...row.status,
      retiredAt: row.status.retiredAt?.toISOString() ?? null,
    },
    priority: value.priority,
    dueDate: value.dueDate,
    creatorId: value.creatorId,
    creator: row.creator,
    assigneeId: value.assigneeId,
    assignee: row.assignee,
    projectId: value.projectId,
    project: row.project
      ? {
          ...row.project,
          archivedAt: row.project.archivedAt?.toISOString() ?? null,
        }
      : null,
    version: value.version,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    archivedAt: value.archivedAt?.toISOString() ?? null,
    capabilities: {
      canEdit: activeTeam && value.archivedAt === null,
      canArchive: activeTeam && manage && value.archivedAt === null,
      canRestore: activeTeam && manage && value.archivedAt !== null,
    },
  };
}
export function presentIssue(row: IssueAccess) {
  return { ...presentIssueSummary(row), description: row.issue.description };
}
