import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { createDatabase } from "@kithwork/database";
type Database = ReturnType<typeof createDatabase>["db"];
export type PublicationClaim = {
  id: string;
  expiresAt: number;
  requestId: string | null;
  leaseId: string;
  attempt: number;
};
export function createPublicationStore(db: Database) {
  return {
    async claimPublication(): Promise<PublicationClaim[]> {
      const leaseId = randomUUID();
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '2s'`);
        return tx.execute<PublicationClaim>(sql`with due as (
          select id from email_outbox where completed_at is null
            and next_publish_at <= clock_timestamp()
            and (publish_lease_until is null or publish_lease_until <= clock_timestamp())
            and (delivery_lease_until is null or delivery_lease_until <= clock_timestamp())
          order by next_publish_at,id limit 10 for update skip locked
        ) update email_outbox o set publish_lease_id=${leaseId},
          publish_lease_until=clock_timestamp()+interval '30 seconds',
          next_publish_at=clock_timestamp()+interval '30 seconds', publication_attempts=publication_attempts+1
        from due where o.id=due.id returning o.id,(extract(epoch from o.expires_at)*1000)::double precision as "expiresAt",o.request_id as "requestId",
          o.publish_lease_id as "leaseId",o.publication_attempts as attempt`);
      });
      return result.rows;
    },
    async publicationSucceeded(claim: PublicationClaim) {
      await db.execute(sql`update email_outbox set last_published_at=clock_timestamp(), next_publish_at=clock_timestamp()+interval '60 seconds',
        publish_lease_id=null,publish_lease_until=null where id=${claim.id} and publish_lease_id=${claim.leaseId} and completed_at is null`);
    },
    async publicationFailed(claim: PublicationClaim) {
      const delay = Math.min(
        60_000,
        1000 * 2 ** Math.min(claim.attempt - 1, 6),
      );
      await db.execute(sql`update email_outbox set next_publish_at=clock_timestamp()+${delay} * interval '1 millisecond',
        publish_lease_id=null,publish_lease_until=null,last_error_code='queue_unavailable'
        where id=${claim.id} and publish_lease_id=${claim.leaseId} and completed_at is null`);
    },
  };
}
