import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "../../platform/database/types.js";
import { issue } from "./access.js";
import { issueConflict } from "./errors.js";

export async function requireUnlinkedProjectTeams(
  tx: Transaction,
  organisationId: string,
  projectId: string,
  teamIds: string[],
) {
  if (!teamIds.length) return;
  const [linked] = await tx
    .select({ id: issue.id })
    .from(issue)
    .where(
      and(
        eq(issue.organisationId, organisationId),
        eq(issue.projectId, projectId),
        inArray(issue.teamId, teamIds),
      ),
    )
    .limit(1);
  if (linked)
    throw issueConflict(
      "Clear issue project links before removing participating teams",
    );
}
