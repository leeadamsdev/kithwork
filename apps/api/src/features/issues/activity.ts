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
const snapshot = (status: StatusSnapshot) => ({
  id: status.id,
  name: status.name,
  category: status.category,
});
export function issueChanges(
  previous: IssueRow | null,
  current: IssueRow,
  oldStatus: StatusSnapshot | null,
  newStatus: StatusSnapshot,
): IssueChangeValues {
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
      from: oldStatus ? snapshot(oldStatus) : null,
      to: snapshot(newStatus),
    };
  if (!previous || previous.priority !== current.priority)
    changes.priority = {
      from: previous?.priority ?? null,
      to: current.priority,
    };
  if ((previous?.dueDate ?? null) !== current.dueDate)
    changes.dueDate = { from: previous?.dueDate ?? null, to: current.dueDate };
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
  previous: IssueRow | null,
  current: IssueRow,
  kind: IssueActivityKind,
  oldStatus: StatusSnapshot | null,
  newStatus: StatusSnapshot,
) {
  await tx.insert(issueActivitySchema.issueActivity).values({
    organisationId: current.organisationId,
    issueId: current.id,
    issueVersion: current.version,
    actorId: actor.id,
    actorName: actor.name,
    kind,
    cause: "user",
    changes: issueChanges(previous, current, oldStatus, newStatus),
  });
}
