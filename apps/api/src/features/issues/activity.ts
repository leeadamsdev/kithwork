import type {
  AuthenticatedUser,
  IssueActivityKind,
  IssueChangeValues,
} from "@kithwork/contracts";
import { issueActivitySchema } from "@kithwork/database";
import type { Transaction } from "../../platform/database/types.js";
import type { IssueRow, IssueAccess } from "./access.js";

export type IssueActor = Pick<AuthenticatedUser, "id" | "name">;
type StatusSnapshot = Pick<IssueAccess["status"], "id" | "name" | "category">;
type ActivityState = {
  issue: IssueRow;
  status: StatusSnapshot;
  assignee: IssueAccess["assignee"];
};
const snapshot = (status: StatusSnapshot) => ({
  id: status.id,
  name: status.name,
  category: status.category,
});
export function issueChanges(
  before: ActivityState | null,
  after: ActivityState,
): IssueChangeValues {
  const previous = before?.issue ?? null,
    current = after.issue;
  const changes: IssueChangeValues = {};
  if (!previous || previous.title !== current.title)
    changes.title = { from: previous?.title ?? null, to: current.title };
  if (
    previous
      ? previous.description !== current.description
      : current.description !== null
  )
    changes.description = { changed: true };
  if (!previous || previous.statusId !== current.statusId)
    changes.status = {
      from: before ? snapshot(before.status) : null,
      to: snapshot(after.status),
    };
  if (!previous || previous.priority !== current.priority)
    changes.priority = {
      from: previous?.priority ?? null,
      to: current.priority,
    };
  if ((previous?.dueDate ?? null) !== current.dueDate)
    changes.dueDate = { from: previous?.dueDate ?? null, to: current.dueDate };
  if ((previous?.assigneeId ?? null) !== current.assigneeId)
    changes.assignee = { from: before?.assignee ?? null, to: after.assignee };
  if ((previous?.projectId ?? null) !== current.projectId)
    changes.project = {
      from: previous?.projectId ?? null,
      to: current.projectId,
    };
  if (
    (previous?.archivedAt?.getTime() ?? null) !==
    (current.archivedAt?.getTime() ?? null)
  )
    changes.archivedAt = {
      from: previous?.archivedAt?.toISOString() ?? null,
      to: current.archivedAt?.toISOString() ?? null,
    };
  return changes;
}
export async function appendIssueActivity(
  tx: Transaction,
  actor: IssueActor,
  previous: ActivityState | null,
  current: ActivityState,
  kind: IssueActivityKind,
) {
  await tx.insert(issueActivitySchema.issueActivity).values({
    organisationId: current.issue.organisationId,
    issueId: current.issue.id,
    issueVersion: current.issue.version,
    actorId: actor.id,
    actorName: actor.name,
    kind,
    cause: "user",
    changes: issueChanges(previous, current),
  });
}
