import { organisationsSchema } from "@kithwork/database";
import { eq } from "drizzle-orm";
import type { Database } from "../../platform/database/types.js";
import { canUpdateOrganisation } from "./policies.js";
import { withLockedOrganisation } from "./transaction.js";
import { forbidden } from "./errors.js";
import { summary } from "./presentation.js";
const { organisation, organisationMember } = organisationsSchema;

export async function createOrganisation(
  db: Database,
  actorId: string,
  name: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(organisation).values({ name }).returning();
    await tx
      .insert(organisationMember)
      .values({ organisationId: row!.id, userId: actorId, role: "owner" });
    return summary({ ...row!, role: "owner" });
  });
}

export async function updateOrganisation(
  db: Database,
  actorId: string,
  organisationId: string,
  name: string,
) {
  return withLockedOrganisation(
    db,
    actorId,
    organisationId,
    async (tx, access) => {
      if (!canUpdateOrganisation(access.role)) throw forbidden();
      const [row] = await tx
        .update(organisation)
        .set({ name })
        .where(eq(organisation.id, organisationId))
        .returning();
      return summary({ ...row!, role: access.role });
    },
  );
}
