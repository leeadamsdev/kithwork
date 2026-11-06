import { authSchema } from "@kithwork/database";
import { and, eq, gt } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import {
  actorTeamMember,
  organisationMember,
  readTeamAccess,
  team,
  teamMember,
  teamReadPredicate,
} from "./access.js";
import { teamUnavailable } from "./errors.js";

const selection = {
  userId: teamMember.userId,
  name: authSchema.user.name,
  role: teamMember.role,
  joinedAt: teamMember.createdAt,
};
export type MemberRow = {
  userId: string;
  name: string;
  role: "maintainer" | "member";
  joinedAt: Date;
};
export const presentMember = (row: MemberRow) => ({
  ...row,
  joinedAt: row.joinedAt.toISOString(),
});
export async function findTeamMember(
  db: Database | Transaction,
  input: { organisationId: string; teamId: string; userId: string },
) {
  const [row] = await db
    .select(selection)
    .from(teamMember)
    .innerJoin(authSchema.user, eq(authSchema.user.id, teamMember.userId))
    .where(
      and(
        eq(teamMember.organisationId, input.organisationId),
        eq(teamMember.teamId, input.teamId),
        eq(teamMember.userId, input.userId),
      ),
    );
  return row;
}
export async function listTeamMembers(
  db: Database,
  actorId: string,
  input: {
    organisationId: string;
    teamId: string;
    cursor?: string | undefined;
    limit: number;
  },
) {
  await readTeamAccess(db, actorId, input.organisationId, input.teamId);
  // Repeat visibility in the data query so revocation between statements cannot expose members.
  const rows = await db
    .select(selection)
    .from(teamMember)
    .innerJoin(authSchema.user, eq(authSchema.user.id, teamMember.userId))
    .innerJoin(
      team,
      and(
        eq(team.id, teamMember.teamId),
        eq(team.organisationId, teamMember.organisationId),
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
        eq(teamMember.organisationId, input.organisationId),
        eq(teamMember.teamId, input.teamId),
        teamReadPredicate(),
        input.cursor ? gt(teamMember.userId, input.cursor) : undefined,
      ),
    )
    .orderBy(teamMember.userId)
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map(presentMember);
  return {
    items,
    nextCursor: rows.length > input.limit ? items.at(-1)!.userId : null,
  };
}
export async function requireTeamMember(
  tx: Transaction,
  input: { organisationId: string; teamId: string; userId: string },
) {
  const row = await findTeamMember(tx, input);
  if (!row) throw teamUnavailable();
  return row;
}
