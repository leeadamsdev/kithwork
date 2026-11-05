import { expect, it } from "vitest";
import { createOutboxStore } from "../../../../apps/worker/src/features/outbox/store.js";
import { outboxDatabase } from "./fixtures.js";

it("limits each expiry sweep to a bounded batch and eventually clears a larger backlog", async () => {
  const database = await outboxDatabase();
  try {
    await database.pool.query(
      `with invitations as (
      insert into organisation_invitation(organisation_id,issuer_id,email,role,token_hash,expires_at)
      select $1,$2,gen_random_uuid()::text || '@example.test','member',repeat('a',64),now()-interval '1 day'
      from generate_series(1,101) returning id
    ) insert into email_outbox(invitation_id,invitation_version,payload,expires_at)
      select id,1,'{}',now()-interval '1 day' from invitations`,
      [database.organisationId, database.userId],
    );
    const store = createOutboxStore(database.db);
    await store.maintain();
    expect(
      (
        await database.pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM email_outbox WHERE completed_at is null",
        )
      ).rows[0]!.count,
    ).toBe(1);
    await store.maintain();
    expect(
      (
        await database.pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM email_outbox WHERE payload is not null",
        )
      ).rows[0]!.count,
    ).toBe(0);
  } finally {
    await database.close();
  }
});

it("bounds maintenance, scrubs expired payloads and prunes terminal retention", async () => {
  const database = await outboxDatabase();
  const store = createOutboxStore(database.db);
  try {
    const event = await database.event();
    await database.pool.query(
      "UPDATE email_outbox SET expires_at=now()-interval '1 second' WHERE id=$1",
      [event.id],
    );
    await store.maintain();
    expect(
      (
        await database.pool.query(
          "SELECT payload,outcome FROM email_outbox WHERE id=$1",
          [event.id],
        )
      ).rows[0],
    ).toEqual({ payload: null, outcome: "skipped" });
    await database.pool.query(
      "UPDATE email_outbox SET completed_at=now()-interval '8 days' WHERE id=$1",
      [event.id],
    );
    await store.maintain();
    expect(
      (
        await database.pool.query("SELECT id FROM email_outbox WHERE id=$1", [
          event.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect((await store.claimDelivery(event.id)).kind).toBe("skipped");
    await database.pool.query(
      "UPDATE organisation_invitation SET expires_at=now()-interval '31 days' WHERE id=$1",
      [event.invitationId],
    );
    await store.maintain();
    expect(
      (
        await database.pool.query(
          "SELECT id FROM organisation_invitation WHERE id=$1",
          [event.invitationId],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await database.close();
  }
});
