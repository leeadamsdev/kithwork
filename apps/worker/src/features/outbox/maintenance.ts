import { sql } from "drizzle-orm";
import type { createDatabase } from "@kithwork/database";
type Database = ReturnType<typeof createDatabase>["db"];

export async function maintainOutbox(db: Database) {
  await db.execute(sql`with obsolete as (
        select o.id from email_outbox o where o.completed_at is null and (o.expires_at<=clock_timestamp() or not exists (
          select 1 from organisation_invitation i where i.id=o.invitation_id and i.status='pending' and i.version=o.invitation_version and i.expires_at>clock_timestamp()
        )) order by o.next_publish_at,o.id limit 100 for update skip locked
      ) update email_outbox o set payload=null,outcome='skipped',last_error_code='obsolete',completed_at=clock_timestamp(),
        publish_lease_id=null,publish_lease_until=null,delivery_lease_id=null,delivery_lease_until=null from obsolete where o.id=obsolete.id`);
  await db.execute(
    sql`delete from email_outbox where id in (select id from email_outbox where completed_at<clock_timestamp()-interval '7 days' order by completed_at,id limit 100 for update skip locked)`,
  );
  await db.execute(sql`delete from organisation_invitation where id in (
        select i.id from organisation_invitation i where ((i.status='pending' and i.expires_at<clock_timestamp()-interval '30 days')
          or (i.status<>'pending' and i.updated_at<clock_timestamp()-interval '30 days'))
          and not exists (select 1 from email_outbox o where o.invitation_id=i.id and o.completed_at is null)
        order by i.expires_at,i.id limit 100 for update skip locked
      )`);
}
