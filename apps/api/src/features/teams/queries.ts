import type { TeamPageInput } from "@kithwork/contracts";
import type { Database } from "../../platform/database/types.js";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import {
  actorTeamMember,
  readTeamAccess,
  selectTeamAccess,
  team,
  teamReadPredicate,
} from "./access.js";
import { presentTeam } from "./presentation.js";

export async function getTeam(
  db: Database,
  actorId: string,
  input: { organisationId: string; teamId: string },
) {
  const access = await readTeamAccess(
    db,
    actorId,
    input.organisationId,
    input.teamId,
  );
  return presentTeam(
    access.team,
    access.organisationRole,
    access.membershipRole,
  );
}
export async function listTeams(
  db: Database,
  actorId: string,
  input: TeamPageInput,
) {
  const rows = await selectTeamAccess(db, actorId)
    .where(
      and(
        eq(team.organisationId, input.organisationId),
        teamReadPredicate(),
        input.scope === "mine" ? isNotNull(actorTeamMember.userId) : undefined,
        input.archived === "exclude"
          ? isNull(team.archivedAt)
          : input.archived === "only"
            ? isNotNull(team.archivedAt)
            : undefined,
        input.cursor ? gt(team.id, input.cursor) : undefined,
      ),
    )
    .orderBy(team.id)
    .limit(input.limit + 1);
  const items = rows
    .slice(0, input.limit)
    .map((row) =>
      presentTeam(row.team, row.organisationRole, row.membershipRole),
    );
  return {
    items,
    nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
  };
}
