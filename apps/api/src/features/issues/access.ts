import { authSchema, issuesSchema, workflowsSchema } from "@kithwork/database";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../../platform/database/types.js";
import {
  actorTeamMember,
  organisationMember,
  team,
  teamReadPredicate,
} from "../teams/access.js";
import { issueUnavailable } from "./errors.js";

export const { issue, issueCounter } = issuesSchema;
export const { workflowStatus } = workflowsSchema;
const creator = alias(authSchema.user, "issue_creator");
export type IssueScope = { organisationId: string; issueId: string };
export type IssueRow = typeof issue.$inferSelect;
export const issueScope = (input: IssueScope) =>
  and(
    eq(issue.organisationId, input.organisationId),
    eq(issue.id, input.issueId),
  );
export function selectIssueAccess(db: Database | Transaction, actorId: string) {
  return db
    .select({
      issue,
      team: { id: team.id, key: team.key, archivedAt: team.archivedAt },
      organisationRole: organisationMember.role,
      membershipRole: actorTeamMember.role,
      status: {
        id: workflowStatus.id,
        name: workflowStatus.name,
        category: workflowStatus.category,
        retiredAt: workflowStatus.retiredAt,
      },
      creator: { id: creator.id, name: creator.name },
    })
    .from(issue)
    .innerJoin(
      team,
      and(
        eq(team.organisationId, issue.organisationId),
        eq(team.id, issue.teamId),
      ),
    )
    .innerJoin(
      organisationMember,
      and(
        eq(organisationMember.organisationId, issue.organisationId),
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
    .innerJoin(
      workflowStatus,
      and(
        eq(workflowStatus.organisationId, issue.organisationId),
        eq(workflowStatus.teamId, issue.teamId),
        eq(workflowStatus.id, issue.statusId),
      ),
    )
    .leftJoin(creator, eq(creator.id, issue.creatorId));
}
export type IssueAccess = Awaited<ReturnType<typeof selectIssueAccess>>[number];
export async function readIssueAccess(
  db: Database | Transaction,
  actorId: string,
  input: IssueScope,
) {
  const [row] = await selectIssueAccess(db, actorId).where(
    and(issueScope(input), teamReadPredicate()),
  );
  if (!row) throw issueUnavailable();
  return row;
}
export async function readStatusAccess(
  db: Database | Transaction,
  actorId: string,
  organisationId: string,
  statusId: string,
) {
  const [row] = await db
    .select({ teamId: workflowStatus.teamId })
    .from(workflowStatus)
    .innerJoin(
      team,
      and(
        eq(team.organisationId, workflowStatus.organisationId),
        eq(team.id, workflowStatus.teamId),
      ),
    )
    .innerJoin(
      organisationMember,
      and(
        eq(organisationMember.organisationId, team.organisationId),
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
    .where(
      and(
        eq(workflowStatus.organisationId, organisationId),
        eq(workflowStatus.id, statusId),
        teamReadPredicate(),
      ),
    );
  if (!row) throw issueUnavailable();
  return row;
}
