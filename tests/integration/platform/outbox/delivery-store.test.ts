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

it("persists delivery results, scrubs bearer payloads and ignores completed replays", async () => {
  const event = await database.event();
  const claim = await store.claimDelivery(event.id);
  expect(claim.kind).toBe("deliver");
  if (claim.kind !== "deliver") throw new Error("Expected claim");
  expect(claim.expiresAt).toBe(event.expiresAt);
  expect((await store.claimDelivery(event.id)).kind).toBe("busy");
  await store.delivered(claim);
  expect(
    (
      await database.pool.query(
        "SELECT payload,outcome,delivery_attempts FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0],
  ).toEqual({ payload: null, outcome: "sent", delivery_attempts: 1 });
  expect((await store.claimDelivery(event.id)).kind).toBe("skipped");
});
it("enforces a durable attempt budget across crashed deliveries and expired leases", async () => {
  const event = await database.event();
  for (let attempt = 1; attempt <= 5; attempt++) {
    const claim = await store.claimDelivery(event.id);
    expect(claim.kind).toBe("deliver");
    if (claim.kind !== "deliver") throw new Error("Expected claim");
    expect(claim.attempt).toBe(attempt);
    await database.pool.query(
      "UPDATE email_outbox SET delivery_lease_until=now()-interval '1 second' WHERE id=$1",
      [event.id],
    );
  }
  expect((await store.claimDelivery(event.id)).kind).toBe("failed");
  expect(
    (
      await database.pool.query(
        "SELECT payload,outcome,last_error_code FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0],
  ).toEqual({
    payload: null,
    outcome: "failed",
    last_error_code: "attempts_exhausted",
  });
});
it("skips revoked, expired and superseded invitations before delivery", async () => {
  for (const change of [
    "status='revoked'",
    "expires_at=now()-interval '1 second'",
    "version=version+1",
  ]) {
    const event = await database.event();
    await database.pool.query(
      `UPDATE organisation_invitation SET ${change} WHERE id=$1`,
      [event.invitationId],
    );
    expect((await store.claimDelivery(event.id)).kind).toBe("skipped");
    expect(
      (
        await database.pool.query(
          "SELECT payload,outcome FROM email_outbox WHERE id=$1",
          [event.id],
        )
      ).rows[0],
    ).toEqual({ payload: null, outcome: "skipped" });
  }
});
it("prevents an old delivery lease from overwriting a newer outcome", async () => {
  const event = await database.event();
  const first = await store.claimDelivery(event.id);
  if (first.kind !== "deliver") throw new Error("Expected claim");
  await database.pool.query(
    "UPDATE email_outbox SET delivery_lease_until=now()-interval '1 second' WHERE id=$1",
    [event.id],
  );
  const second = await store.claimDelivery(event.id);
  if (second.kind !== "deliver") throw new Error("Expected claim");
  await store.deliveryFailed(second, "smtp_rejected", true);
  await store.delivered(first);
  expect(
    (
      await database.pool.query<{ outcome: string }>(
        "SELECT outcome FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0]?.outcome,
  ).toBe("failed");
});
it("rechecks expiration after waiting for a locked outbox row", async () => {
  const event = await database.event();
  const blocker = await database.pool.connect();
  try {
    await database.pool.query(
      "UPDATE organisation_invitation SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1",
      [event.invitationId],
    );
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM email_outbox WHERE id=$1 FOR UPDATE", [
      event.id,
    ]);
    const delivery = store.claimDelivery(event.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await blocker.query("COMMIT");
    expect((await delivery).kind).toBe("skipped");
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});
