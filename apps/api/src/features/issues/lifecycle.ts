import type { VersionedIssueInput } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { canManageTeam } from "../teams/policies.js";
import { issueConflict, issueForbidden } from "./errors.js";
import { appendIssueActivity, type IssueActor } from "./activity.js";
import { getIssue } from "./queries.js";
import {
  requireActiveStatus,
  requireIssueVersion,
  saveIssue,
  withLockedIssue,
} from "./transaction.js";

export function setIssueArchived(
  db: Database,
  actor: IssueActor,
  input: VersionedIssueInput & { statusId?: string | undefined },
  archived: boolean,
) {
  return withLockedIssue(db, actor.id, input, async (tx, access) => {
    if (!canManageTeam(access.organisationRole, access.membershipRole))
      throw issueForbidden();
    if (access.team.archivedAt)
      throw issueConflict("Restore this team before changing its issues");
    const row = access.issue;
    if ((row.archivedAt !== null) === archived)
      return getIssue(tx, actor.id, input);
    requireIssueVersion(row, input.expectedVersion);
    const status = archived
      ? access.status
      : await requireActiveStatus(tx, row, input.statusId ?? row.statusId);
    const updated = await saveIssue(tx, row, {
      archivedAt: archived ? new Date() : null,
      statusId: status.id,
    });
    await appendIssueActivity(
      tx,
      actor,
      row,
      updated,
      archived ? "archived" : "restored",
      access.status,
      status,
    );
    return getIssue(tx, actor.id, input);
  });
}
