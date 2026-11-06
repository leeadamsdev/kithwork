import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { withLockedOrganisation } from "../organisations/transaction.js";
import { lockTeamAccess, team } from "./access.js";
import type { TeamRow } from "./presentation.js";
import { teamConflict } from "./errors.js";

export function withLockedTeam<T>(
  db: Database,
  actorId: string,
  input: { organisationId: string; teamId: string },
  action: (
    tx: Transaction,
    access: Awaited<ReturnType<typeof lockTeamAccess>>,
  ) => Promise<T>,
) {
  return withLockedOrganisation(
    db,
    actorId,
    input.organisationId,
    async (tx, organisation) => {
      const access = await lockTeamAccess(
        tx,
        actorId,
        input.organisationId,
        input.teamId,
        organisation.role,
      );
      return action(tx, access);
    },
  );
}
export function requireActiveTeam(row: Pick<TeamRow, "archivedAt">) {
  if (row.archivedAt)
    throw teamConflict("Restore this team before changing it");
}
export function requireTeamVersion(row: TeamRow, expectedVersion: number) {
  if (row.version !== expectedVersion)
    throw teamConflict("Team has changed; refresh and retry");
}
export async function saveTeam(
  tx: Transaction,
  row: TeamRow,
  values: Partial<
    Pick<TeamRow, "name" | "description" | "visibility" | "archivedAt">
  >,
) {
  const [updated] = await tx
    .update(team)
    .set({
      ...values,
      version: sql`${team.version}+1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(eq(team.organisationId, row.organisationId), eq(team.id, row.id)),
    )
    .returning();
  return updated!;
}
