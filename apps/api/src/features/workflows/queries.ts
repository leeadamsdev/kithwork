import {
  maxActiveWorkflowStatuses,
  type WorkflowStatusPageInput,
} from "@kithwork/contracts";
import type { Database, Transaction } from "../../platform/database/types.js";
import { canManageTeam } from "../teams/policies.js";
import { readWorkflowPage, type WorkflowScope } from "./access.js";
import { presentWorkflowStatus } from "./presentation.js";

export async function getWorkflow(
  db: Database | Transaction,
  actorId: string,
  input: WorkflowScope,
) {
  const { header, statuses } = await readWorkflowPage(db, actorId, input, {
    retired: "exclude",
    ordered: true,
    limit: maxActiveWorkflowStatuses,
  });
  return {
    organisationId: header.organisationId,
    teamId: header.teamId,
    version: header.version,
    statuses: statuses.map(presentWorkflowStatus),
    capabilities: {
      canManage:
        header.archivedAt === null &&
        canManageTeam(header.organisationRole, header.membershipRole),
    },
  };
}
export async function listWorkflowStatuses(
  db: Database,
  actorId: string,
  input: WorkflowStatusPageInput,
) {
  const { header, statuses } = await readWorkflowPage(db, actorId, input, {
    retired: input.retired,
    cursor: input.cursor,
    ordered: false,
    limit: input.limit + 1,
  });
  const items = statuses.slice(0, input.limit).map(presentWorkflowStatus);
  return {
    version: header.version,
    items,
    nextCursor: statuses.length > input.limit ? items.at(-1)!.id : null,
  };
}
