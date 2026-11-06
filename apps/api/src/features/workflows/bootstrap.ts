import { workflowsSchema } from "@kithwork/database";
import type { WorkflowCategory } from "@kithwork/contracts";
import type { Transaction } from "../../platform/database/types.js";

const defaults: { category: WorkflowCategory; name: string }[] = [
  { category: "backlog", name: "Backlog" },
  { category: "unstarted", name: "Todo" },
  { category: "started", name: "In Progress" },
  { category: "completed", name: "Done" },
  { category: "cancelled", name: "Cancelled" },
];
export async function initialiseTeamWorkflow(
  tx: Transaction,
  organisationId: string,
  teamId: string,
) {
  await tx
    .insert(workflowsSchema.teamWorkflow)
    .values({ organisationId, teamId });
  await tx.insert(workflowsSchema.workflowStatus).values(
    defaults.map((status) => ({
      ...status,
      organisationId,
      teamId,
      position: 0,
      isDefault: status.category === "backlog",
    })),
  );
}
