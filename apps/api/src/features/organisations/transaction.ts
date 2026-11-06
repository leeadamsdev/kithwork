import { organisationsSchema } from "@kithwork/database";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Database, Transaction } from "../../platform/database/types.js";
import { databaseErrorCode } from "../../platform/database/errors.js";
import { loadOrganisationAccess } from "./access.js";
import { missing } from "./errors.js";
const { organisation } = organisationsSchema;
export async function withLockedOrganisation<T>(
  db: Database,
  actorId: string,
  organisationId: string,
  action: (
    tx: Transaction,
    access: Awaited<ReturnType<typeof loadOrganisationAccess>>,
  ) => Promise<T>,
) {
  return withOrganisationLock(db, organisationId, async (tx) => {
    const access = await loadOrganisationAccess(tx, actorId, organisationId);
    return action(tx, access);
  });
}

export async function withOrganisationLock<T>(
  db: Database,
  organisationId: string,
  action: (tx: Transaction) => Promise<T>,
) {
  return withOrganisationBarrier(db, organisationId, "update", action);
}

export function withSharedOrganisationAccess<T>(
  db: Database,
  actorId: string,
  organisationId: string,
  action: (
    tx: Transaction,
    access: Awaited<ReturnType<typeof loadOrganisationAccess>>,
  ) => Promise<T>,
) {
  return withOrganisationBarrier(db, organisationId, "share", async (tx) => {
    const access = await loadOrganisationAccess(tx, actorId, organisationId);
    return action(tx, access);
  });
}

function withOrganisationBarrier<T>(
  db: Database,
  organisationId: string,
  mode: "share" | "update",
  action: (tx: Transaction) => Promise<T>,
) {
  return db
    .transaction(
      async (tx) => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local statement_timeout = '5s'`);
        // Shared issue writers coexist; exclusive administration blocks membership/privacy changes.
        // Both callers re-read permissions after acquiring the barrier.
        const [row] = await tx
          .select({ id: organisation.id })
          .from(organisation)
          .where(eq(organisation.id, organisationId))
          .for(mode);
        if (!row) throw missing();
        return action(tx);
      },
      { isolationLevel: "read committed" },
    )
    .catch((error: unknown) => {
      if (databaseErrorCode(error) === "55P03")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Organisation is busy; retry your request",
        });
      throw error;
    });
}
