import { afterAll, beforeAll, expect, it } from "vitest";
import { createOutboxStore } from "../../../../apps/worker/src/features/outbox/store.js";
import { createOutboxDelivery } from "../../../../apps/worker/src/features/outbox/delivery.js";
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

it("sends once after success, decrypts only for the current invitation and fences replays", async () => {
  const event = await database.event();
  const sent: unknown[] = [];
  const delivery = createOutboxDelivery({
    store,
    encryptionKey: database.key.toString("base64"),
    deliver: (message, id) => {
      sent.push({ message, id });
      return Promise.resolve();
    },
    onEvent: () => {},
  });
  expect(await delivery(event.id)).toBe("delivered");
  expect(await delivery(event.id)).toBe("skipped");
  expect(sent).toEqual([{ message: event.message, id: event.id }]);
});
it("counts transient failures durably and makes SMTP rejection terminal", async () => {
  const event = await database.event();
  let calls = 0;
  const deliver = createOutboxDelivery({
    store,
    encryptionKey: database.key.toString("base64"),
    deliver: () => {
      calls++;
      return Promise.reject(new Error("sensitive SMTP transcript"));
    },
    onEvent: () => {},
  });
  for (let attempt = 0; attempt < 4; attempt++)
    await expect(deliver(event.id)).rejects.toThrow(
      "Outbox email delivery failed",
    );
  expect(await deliver(event.id)).toBe("failed");
  expect(await deliver(event.id)).toBe("skipped");
  expect(calls).toBe(5);
  const rejected = await database.event();
  const permanent = createOutboxDelivery({
    store,
    encryptionKey: database.key.toString("base64"),
    deliver: () =>
      Promise.reject(
        Object.assign(new Error("recipient secret"), { responseCode: 550 }),
      ),
    onEvent: () => {},
  });
  expect(await permanent(rejected.id)).toBe("failed");
  expect(
    (
      await database.pool.query(
        "SELECT outcome,payload,delivery_attempts FROM email_outbox WHERE id=$1",
        [rejected.id],
      )
    ).rows[0],
  ).toEqual({ outcome: "failed", payload: null, delivery_attempts: 1 });
});
it("fails invalid ciphertext without sending or leaking supplied payloads", async () => {
  const event = await database.event();
  await database.pool.query(
    "UPDATE email_outbox SET payload='{}' WHERE id=$1",
    [event.id],
  );
  const deliver = createOutboxDelivery({
    store,
    encryptionKey: database.key.toString("base64"),
    deliver: () => {
      throw new Error("Must not send");
    },
    onEvent: () => {},
  });
  expect(await deliver(event.id)).toBe("failed");
  expect(
    (
      await database.pool.query(
        "SELECT last_error_code,payload FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0],
  ).toEqual({ last_error_code: "invalid_payload", payload: null });
});
it("keeps unacknowledged SMTP success recoverable with a stable message id", async () => {
  const event = await database.event();
  const messageIds: string[] = [];
  const deliver = (_message: unknown, id: string) => {
    messageIds.push(id);
    return Promise.resolve();
  };
  const interrupted = createOutboxDelivery({
    store: {
      ...store,
      delivered: () =>
        Promise.reject(new Error("database failure with private SQL")),
    },
    encryptionKey: database.key.toString("base64"),
    deliver,
    onEvent: () => {},
  });
  await expect(interrupted(event.id)).rejects.toThrow(
    "Outbox email delivery failed",
  );
  expect(
    (
      await database.pool.query<{ outcome: string | null }>(
        "SELECT outcome FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0]!.outcome,
  ).toBeNull();
  await database.pool.query(
    "UPDATE email_outbox SET delivery_lease_until=now()-interval '1 second' WHERE id=$1",
    [event.id],
  );
  const resumed = createOutboxDelivery({
    store,
    encryptionKey: database.key.toString("base64"),
    deliver,
    onEvent: () => {},
  });
  expect(await resumed(event.id)).toBe("delivered");
  expect(await resumed(event.id)).toBe("skipped");
  // SMTP has no transaction with PostgreSQL: this crash window can duplicate mail.
  expect(messageIds).toEqual([event.id, event.id]);
});
