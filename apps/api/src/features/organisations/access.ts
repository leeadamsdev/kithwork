import { organisationsSchema } from "@kithwork/database";
import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../platform/database/types.js";
import { summary } from "./presentation.js";
import { missing } from "./errors.js";
const { organisation, organisationMember } = organisationsSchema;
export async function loadOrganisationAccess(
  db: Database | Transaction,
  actorId: string,
  organisationId: string,
) {
  const [row] = await db
    .select({
      id: organisation.id,
      name: organisation.name,
      createdAt: organisation.createdAt,
      updatedAt: organisation.updatedAt,
      role: organisationMember.role,
    })
    .from(organisation)
    .innerJoin(
      organisationMember,
      eq(organisationMember.organisationId, organisation.id),
    )
    .where(
      and(
        eq(organisation.id, organisationId),
        eq(organisationMember.userId, actorId),
      ),
    );
  if (!row) throw missing();
  return summary(row);
}
