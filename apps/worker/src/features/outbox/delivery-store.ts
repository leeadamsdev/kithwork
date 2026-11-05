import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { createDatabase } from "@kithwork/database";

type Database = ReturnType<typeof createDatabase>["db"];
type Executor = Pick<Database, "execute">;

export type DeliveryClaim = {
  kind: "deliver";
  id: string;
  leaseId: string;
  payload: unknown;
  attempt: number;
  email: string;
  expiresAt: number;
  organisationId: string;
  invitationId: string;
  requestId: string | null;
};
export type DeliveryResult =
  DeliveryClaim | { kind: "skipped" | "failed" | "busy" };
type DeliveryRow = Omit<DeliveryClaim, "kind" | "leaseId" | "attempt"> & {
  completedAt: string | null;
  deliveryAttempts: number;
  leaseActive: boolean;
  current: boolean;
};
export type DeliveryErrorCode =
  "smtp_rejected" | "smtp_transient" | "invalid_payload";

async function complete(
  executor: Executor,
  id: string,
  outcome: "sent" | "skipped" | "failed",
  code: string | null,
  leaseId?: string,
) {
  await executor.execute(sql`update email_outbox set outcome=${outcome}, last_error_code=${code},
    payload=null, completed_at=clock_timestamp(), publish_lease_id=null, publish_lease_until=null,
    delivery_lease_id=null, delivery_lease_until=null
    where id=${id} and completed_at is null ${leaseId ? sql`and delivery_lease_id=${leaseId}` : sql``}`);
}

export function createDeliveryStore(db: Database) {
  return {
    async claimDelivery(id: string): Promise<DeliveryResult> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local statement_timeout = '2s'`);
        await tx.execute(
          sql`select id from email_outbox where id=${id} for update`,
        );
        const result =
          await tx.execute<DeliveryRow>(sql`select o.id,o.payload,o.completed_at as "completedAt",
          (o.delivery_lease_until>clock_timestamp()) as "leaseActive",o.delivery_attempts as "deliveryAttempts",
          (extract(epoch from o.expires_at)*1000)::double precision as "expiresAt",o.request_id as "requestId",i.email,i.organisation_id as "organisationId",i.id as "invitationId",
          (i.status='pending' and i.version=o.invitation_version and i.expires_at>clock_timestamp() and o.expires_at>clock_timestamp()) as current
          from email_outbox o join organisation_invitation i on i.id=o.invitation_id where o.id=${id}`);
        const row = result.rows[0];
        if (!row || row.completedAt) return { kind: "skipped" };
        if (!row.current) {
          await complete(tx, id, "skipped", "obsolete");
          return { kind: "skipped" };
        }
        // Check after acquiring the row lock, rather than against transaction-start time.
        if (row.leaseActive) return { kind: "busy" };
        if (row.deliveryAttempts >= 5) {
          await complete(tx, id, "failed", "attempts_exhausted");
          return { kind: "failed" };
        }
        const leaseId = randomUUID();
        await tx.execute(
          sql`update email_outbox set delivery_lease_id=${leaseId},delivery_lease_until=clock_timestamp()+interval '30 seconds',delivery_attempts=delivery_attempts+1 where id=${id}`,
        );
        return {
          kind: "deliver",
          id,
          leaseId,
          payload: row.payload,
          email: row.email,
          expiresAt: row.expiresAt,
          organisationId: row.organisationId,
          invitationId: row.invitationId,
          requestId: row.requestId,
          attempt: row.deliveryAttempts + 1,
        };
      });
    },
    async delivered(claim: DeliveryClaim) {
      await complete(db, claim.id, "sent", null, claim.leaseId);
    },
    async deliveryFailed(
      claim: DeliveryClaim,
      code: DeliveryErrorCode,
      permanent: boolean,
    ): Promise<boolean> {
      const terminal = permanent || claim.attempt >= 5;
      if (terminal) await complete(db, claim.id, "failed", code, claim.leaseId);
      else
        await db.execute(sql`update email_outbox set delivery_lease_id=null,delivery_lease_until=null,last_error_code=${code}
        where id=${claim.id} and delivery_lease_id=${claim.leaseId} and completed_at is null`);
      return terminal;
    },
  };
}
