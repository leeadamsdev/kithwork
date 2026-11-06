import type { CreateIssueInput, UpdateIssueInput } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { withSharedOrganisationAccess } from "../organisations/transaction.js";
import { readTeamAccess } from "../teams/access.js";
import { requireActiveTeam } from "../teams/transaction.js";
import { issue } from "./access.js";
import { appendIssueActivity, type IssueActor } from "./activity.js";
import { allocateIssueNumber } from "./numbering.js";
import { requireAssignee } from "./assignees.js";
import { requireProjectLink } from "./project-links.js";
import { getIssue } from "./queries.js";
import {
  requireActiveIssue,
  requireActiveStatus,
  requireIssueVersion,
  saveIssue,
  withLockedIssue,
} from "./transaction.js";

export function createIssue(
  db: Database,
  actor: IssueActor,
  input: CreateIssueInput,
) {
  return withSharedOrganisationAccess(
    db,
    actor.id,
    input.organisationId,
    async (tx) => {
      const access = await readTeamAccess(
        tx,
        actor.id,
        input.organisationId,
        input.teamId,
      );
      requireActiveTeam(access.team);
      const status = await requireActiveStatus(tx, input, input.statusId);
      const assignee = input.assigneeId
        ? await requireAssignee(tx, input, input.assigneeId)
        : null;
      const projectId = input.projectId
        ? await requireProjectLink(tx, actor.id, input, input.projectId)
        : null;
      const number = await allocateIssueNumber(
        tx,
        input.organisationId,
        input.teamId,
      );
      const [row] = await tx
        .insert(issue)
        .values({
          organisationId: input.organisationId,
          teamId: input.teamId,
          number,
          title: input.title,
          description: input.description,
          statusId: status.id,
          priority: input.priority,
          dueDate: input.dueDate,
          creatorId: actor.id,
          assigneeId: assignee?.id ?? null,
          projectId,
        })
        .returning();
      await appendIssueActivity(
        tx,
        actor,
        null,
        { issue: row!, status, assignee },
        "created",
      );
      return getIssue(tx, actor.id, {
        organisationId: input.organisationId,
        issueId: row!.id,
      });
    },
  );
}
export function updateIssue(
  db: Database,
  actor: IssueActor,
  input: UpdateIssueInput,
) {
  return withLockedIssue(db, actor.id, input, async (tx, access) => {
    // The shared organisation barrier stabilises team state and workflow status definitions.
    requireActiveTeam(access.team);
    requireActiveIssue(access.issue);
    requireIssueVersion(access.issue, input.expectedVersion);
    const row = access.issue;
    const assignee =
      input.assigneeId === undefined
        ? access.assignee
        : input.assigneeId === null
          ? null
          : await requireAssignee(tx, row, input.assigneeId);
    const projectId =
      input.projectId === undefined
        ? row.projectId
        : input.projectId === null
          ? null
          : input.projectId.toLowerCase() === row.projectId
            ? row.projectId
            : await requireProjectLink(tx, actor.id, row, input.projectId);
    const status =
      input.statusId && input.statusId.toLowerCase() !== row.statusId
        ? await requireActiveStatus(tx, row, input.statusId)
        : access.status;
    const values = {
      title: input.title ?? row.title,
      description:
        input.description === undefined ? row.description : input.description,
      statusId: status.id,
      priority: input.priority ?? row.priority,
      dueDate: input.dueDate === undefined ? row.dueDate : input.dueDate,
      assigneeId: assignee?.id ?? null,
      projectId,
    };
    if (
      values.title !== row.title ||
      values.description !== row.description ||
      values.statusId !== row.statusId ||
      values.priority !== row.priority ||
      values.dueDate !== row.dueDate ||
      values.assigneeId !== row.assigneeId ||
      values.projectId !== row.projectId
    ) {
      const updated = await saveIssue(tx, row, values);
      await appendIssueActivity(
        tx,
        actor,
        access,
        { issue: updated, status, assignee },
        "updated",
      );
    }
    return getIssue(tx, actor.id, input);
  });
}
