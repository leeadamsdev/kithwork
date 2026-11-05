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
  return db
    .transaction(
      async (tx) => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local statement_timeout = '5s'`);
        // Serialize organisation administration, then re-read permissions after waiting.
        // Every membership writer must take this lock before changing membership rows.
        const [row] = await tx
          .select({ id: organisation.id })
          .from(organisation)
          .where(eq(organisation.id, organisationId))
          .for("update");
        if (!row) throw missing();
        const access = await loadOrganisationAccess(
          tx,
          actorId,
          organisationId,
        );
        return action(tx, access);
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
