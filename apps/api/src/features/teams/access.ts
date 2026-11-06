import { organisationsSchema, teamsSchema } from "@kithwork/database";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../../platform/database/types.js";
import type { OrganisationRole } from "@kithwork/contracts";
import { canReadTeam } from "./policies.js";
import { teamUnavailable } from "./errors.js";

export const { team, teamMember } = teamsSchema;
export const { organisationMember } = organisationsSchema;
export const actorTeamMember = alias(teamMember, "actor_team_member");
export const teamReadPredicate = () =>
  or(
    inArray(organisationMember.role, ["owner", "admin"]),
    eq(team.visibility, "organisation"),
    isNotNull(actorTeamMember.userId),
  );

export function selectTeamAccess(db: Database | Transaction, actorId: string) {
  return db
    .select({
      team,
      organisationRole: organisationMember.role,
      membershipRole: actorTeamMember.role,
    })
    .from(team)
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
    );
}
export async function readTeamAccess(
  db: Database | Transaction,
  actorId: string,
  organisationId: string,
  teamId: string,
) {
  const [access] = await selectTeamAccess(db, actorId).where(
    and(
      eq(team.organisationId, organisationId),
      eq(team.id, teamId),
      teamReadPredicate(),
    ),
  );
  if (!access) throw teamUnavailable();
  return access;
}
export async function lockTeamAccess(
  tx: Transaction,
  actorId: string,
  organisationId: string,
  teamId: string,
  organisationRole: OrganisationRole,
) {
  const [row] = await tx
    .select()
    .from(team)
    .where(and(eq(team.organisationId, organisationId), eq(team.id, teamId)))
    .for("update");
  if (!row) throw teamUnavailable();
  const [membership] = await tx
    .select({ role: teamMember.role })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.organisationId, organisationId),
        eq(teamMember.teamId, teamId),
        eq(teamMember.userId, actorId),
      ),
    );
  const membershipRole = membership?.role ?? null;
  if (!canReadTeam(organisationRole, row.visibility, membershipRole))
    throw teamUnavailable();
  return { team: row, organisationRole, membershipRole };
}
