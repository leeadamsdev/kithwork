import { afterAll, beforeAll, expect, it } from "vitest";
import { createOutboxStore } from "../../../../apps/worker/src/features/outbox/store.js";
import { outboxDatabase } from "./fixtures.js";

let database: Awaited<ReturnType<typeof outboxDatabase>>;
let store: ReturnType<typeof createOutboxStore>;
beforeAll(async () => {
  database = await outboxDatabase();
  store = createOutboxStore(database.db);
});
afterAll(async () => {
  await database?.close();
});

it("leases publication claims without holding a transaction during queue IO and fences stale publishers", async () => {
  const event = await database.event();
  const claims = await store.claimPublication();
  const claim = claims.find((c) => c.id === event.id)!;
  expect(claim).toBeDefined();
  expect(claim.expiresAt).toBe(event.expiresAt);
  expect((await store.claimPublication()).map((c) => c.id)).not.toContain(
    event.id,
  );
  await database.pool.query(
    "UPDATE email_outbox SET next_publish_at=now()-interval '1 second', publish_lease_until=now()-interval '1 second' WHERE id=$1",
    [event.id],
  );
  const replacement = (await store.claimPublication()).find(
    (c) => c.id === event.id,
  )!;
  expect(replacement.leaseId).not.toBe(claim.leaseId);
  await store.publicationSucceeded(claim);
  expect(
    (
      await database.pool.query<{ publish_lease_id: string | null }>(
        "SELECT publish_lease_id FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0]?.publish_lease_id,
  ).toBe(replacement.leaseId);
  await store.publicationSucceeded(replacement);
  expect(
    (
      await database.pool.query(
        "SELECT publish_lease_id,last_published_at,outcome FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0],
  ).toMatchObject({ publish_lease_id: null, outcome: null });
});
it("lets simultaneous relay instances claim each pending event once", async () => {
  const event = await database.event();
  const [first, second] = await Promise.all([
    store.claimPublication(),
    store.claimPublication(),
  ]);
  expect(
    [...first, ...second].filter((claim) => claim.id === event.id),
  ).toHaveLength(1);
});
