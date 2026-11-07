import type { IssueMentionTargetsInput } from "@kithwork/contracts";
import { authSchema } from "@kithwork/database";
import { and, eq, exists, gt, ilike, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../../platform/database/types.js";
import {
  organisationMember,
  readTeamAccess,
  selectTeamAccess,
  team,
  teamMember,
  teamReadPredicate,
} from "../teams/access.js";

const eligibleMember = alias(organisationMember, "eligible_member");
const eligibleTeam = alias(team, "eligible_team");
const eligibleTeamMember = alias(teamMember, "eligible_team_member");

// Participation never grants access: assignments, mentions and following use the same current audience.
export function eligibleIssueParticipantPredicate(
  organisationId: string | SQLWrapper,
  teamId: string | SQLWrapper,
  userId: string | SQLWrapper,
) {
  return sql`exists (select 1 from ${organisationMember} ${eligibleMember}
    inner join ${team} ${eligibleTeam} on ${eligibleTeam.organisationId} = ${eligibleMember.organisationId}
    left join ${teamMember} ${eligibleTeamMember} on ${eligibleTeamMember.organisationId} = ${eligibleTeam.organisationId}
      and ${eligibleTeamMember.teamId} = ${eligibleTeam.id} and ${eligibleTeamMember.userId} = ${eligibleMember.userId}
    where ${eligibleMember.organisationId} = ${organisationId} and ${eligibleMember.userId} = ${userId}
      and ${eligibleTeam.id} = ${teamId} and (${eligibleMember.role} in ('owner', 'admin')
        or ${eligibleTeam.visibility} = 'organisation' or ${eligibleTeamMember.userId} is not null))`;
}

export async function listIssueAudience(
  db: Database,
  actorId: string,
  input: IssueMentionTargetsInput,
) {
  await readTeamAccess(db, actorId, input.organisationId, input.teamId);
  const prefix = input.prefix?.replace(/[\\%_]/g, "\\$&");
  const rows = await db
    .select({ id: authSchema.user.id, name: authSchema.user.name })
    .from(authSchema.user)
    .where(
      and(
        eligibleIssueParticipantPredicate(
          input.organisationId,
          input.teamId,
          authSchema.user.id,
        ),
        exists(
          selectTeamAccess(db, actorId).where(
            and(
              eq(team.organisationId, input.organisationId),
              eq(team.id, input.teamId),
              teamReadPredicate(),
            ),
          ),
        ),
        prefix ? ilike(authSchema.user.name, `${prefix}%`) : undefined,
        input.cursor ? gt(authSchema.user.id, input.cursor) : undefined,
      ),
    )
    .orderBy(authSchema.user.id)
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  return {
    items,
    nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
  };
}
