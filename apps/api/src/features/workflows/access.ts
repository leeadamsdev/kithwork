import { workflowsSchema } from "@kithwork/database";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import {
  actorTeamMember,
  organisationMember,
  team,
  teamReadPredicate,
} from "../teams/access.js";
import { workflowUnavailable } from "./errors.js";

export const { teamWorkflow, workflowStatus } = workflowsSchema;
export type WorkflowScope = { organisationId: string; teamId: string };
export const workflowScope = (input: WorkflowScope) =>
  and(
    eq(teamWorkflow.organisationId, input.organisationId),
    eq(teamWorkflow.teamId, input.teamId),
  );
export const statusScope = (input: WorkflowScope) =>
  and(
    eq(workflowStatus.organisationId, input.organisationId),
    eq(workflowStatus.teamId, input.teamId),
  );

export async function readWorkflowPage(
  db: Database | Transaction,
  actorId: string,
  input: WorkflowScope,
  options: {
    retired: "exclude" | "include" | "only";
    cursor?: string | undefined;
    limit: number;
    ordered: boolean;
  },
) {
  const page = db
    .select()
    .from(workflowStatus)
    .where(
      and(
        statusScope(input),
        options.retired === "exclude"
          ? isNull(workflowStatus.retiredAt)
          : options.retired === "only"
            ? isNotNull(workflowStatus.retiredAt)
            : undefined,
        options.cursor ? gt(workflowStatus.id, options.cursor) : undefined,
      ),
    )
    .orderBy(
      ...(options.ordered
        ? [workflowStatus.category, workflowStatus.position, workflowStatus.id]
        : [workflowStatus.id]),
    )
    .limit(options.limit)
    .as("status_page");
  // A left join retains the workflow version on empty pages; all fields share one SQL permission snapshot.
  const rows = await db
    .select({
      organisationId: teamWorkflow.organisationId,
      teamId: teamWorkflow.teamId,
      version: teamWorkflow.version,
      archivedAt: team.archivedAt,
      organisationRole: organisationMember.role,
      membershipRole: actorTeamMember.role,
      status: {
        id: page.id,
        organisationId: page.organisationId,
        teamId: page.teamId,
        name: page.name,
        description: page.description,
        category: page.category,
        position: page.position,
        isDefault: page.isDefault,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
        retiredAt: page.retiredAt,
      },
    })
    .from(teamWorkflow)
    .innerJoin(
      team,
      and(
        eq(team.organisationId, teamWorkflow.organisationId),
        eq(team.id, teamWorkflow.teamId),
      ),
    )
    .innerJoin(
      organisationMember,
      and(
        eq(organisationMember.organisationId, teamWorkflow.organisationId),
        eq(organisationMember.userId, actorId),
      ),
    )
    .leftJoin(
      actorTeamMember,
      and(
        eq(actorTeamMember.organisationId, team.organisationId),
        eq(actorTeamMember.teamId, team.id),
        eq(actorTeamMember.userId, actorId),
      ),
    )
    .leftJoin(page, sql`true`)
    .where(and(workflowScope(input), teamReadPredicate()))
    .orderBy(
      ...(options.ordered
        ? [page.category, page.position, page.id]
        : [page.id]),
    );
  const header = rows[0];
  if (!header) throw workflowUnavailable();
  return {
    header,
    statuses: rows.flatMap((row) => (row.status ? [row.status] : [])),
  };
}
