import type { CreateIssueInput, UpdateIssueInput } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { withSharedOrganisationAccess } from "../organisations/transaction.js";
import { readTeamAccess } from "../teams/access.js";
import { requireActiveTeam } from "../teams/transaction.js";
import { issue } from "./access.js";
import { appendIssueActivity, type IssueActor } from "./activity.js";
import { allocateIssueNumber } from "./numbering.js";
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
        })
        .returning();
      await appendIssueActivity(tx, actor, null, row!, "created", null, status);
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
    };
    if (
      values.title !== row.title ||
      values.description !== row.description ||
      values.statusId !== row.statusId ||
      values.priority !== row.priority ||
      values.dueDate !== row.dueDate
    ) {
      const updated = await saveIssue(tx, row, values);
      await appendIssueActivity(
        tx,
        actor,
        row,
        updated,
        "updated",
        access.status,
        status,
      );
    }
    return getIssue(tx, actor.id, input);
  });
}
