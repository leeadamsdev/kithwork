import { publishOutboxBatch } from "../../../../apps/worker/src/features/outbox/publisher.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Queue } from "bullmq";
import { createEmailProducer } from "@kithwork/email";
import { createEmailWorker, createSmtpDelivery } from "@kithwork/email/worker";
import { createOutboxStore } from "../../../../apps/worker/src/features/outbox/store.js";
import { createOutboxDelivery } from "../../../../apps/worker/src/features/outbox/delivery.js";
import { startOutboxRelay } from "../../../../apps/worker/src/features/outbox/relay.js";
import { integrationServices } from "../../context.js";
import { uniqueNamespace } from "../../support/namespace.js";
import { outboxDatabase } from "./fixtures.js";

let database: Awaited<ReturnType<typeof outboxDatabase>>;
let store: ReturnType<typeof createOutboxStore>;
let producer: Awaited<ReturnType<typeof createEmailProducer>>;
let queue: Queue;
const prefix = uniqueNamespace();
beforeAll(async () => {
  database = await outboxDatabase();
  store = createOutboxStore(database.db);
  producer = await createEmailProducer({
    redisUrl: integrationServices().redisUrl,
    encryptionKey: database.key.toString("base64"),
    prefix,
    onError: () => {},
  });
  queue = new Queue("email", {
    connection: { url: integrationServices().redisUrl },
    prefix,
  });
});
afterAll(async () => {
  await producer?.close();
  if (queue) {
    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  }
  await database?.close();
});
const publish = (reference: {
  id: string;
  expiresAt: number;
  requestId?: string;
}) => producer.ensureOutboxEmail(reference);
const tick = () => publishOutboxBatch({ store, publish, onError: () => {} });
const due = (id: string) =>
  database.pool.query(
    "UPDATE email_outbox SET next_publish_at=now()-interval '1 second',publish_lease_until=null,publish_lease_id=null WHERE id=$1",
    [id],
  );

it("recovers a publication failure, reconciles a lost Redis job, and retains the pending intent", async () => {
  const event = await database.event();
  await publishOutboxBatch({
    store,
    publish: () => Promise.reject(new Error("Redis unavailable")),
    onError: () => {},
  });
  expect(
    (
      await database.pool.query<{ outcome: string | null }>(
        "SELECT payload,outcome FROM email_outbox WHERE id=$1",
        [event.id],
      )
    ).rows[0]?.outcome,
  ).toBeNull();
  await due(event.id);
  await tick();
  expect(await queue.getJob(event.id)).toBeDefined();
  await (await queue.getJob(event.id))!.remove();
  await due(event.id);
  await tick();
  expect((await queue.getJob(event.id))?.data).toEqual({
    outboxId: event.id,
    expiresAt: event.expiresAt,
    requestId: event.requestId,
  });
});
it("recovers after enqueue-before-ack and sends real SMTP once despite job removal/replay", async () => {
  const event = await database.event();
  const claims = await store.claimPublication();
  const claim = claims.find((c) => c.id === event.id)!;
  await publish({
    id: claim.id,
    expiresAt: claim.expiresAt,
    ...(claim.requestId ? { requestId: claim.requestId } : {}),
  });
  await due(event.id);
  await tick();
  const services = integrationServices();
  const smtp = createSmtpDelivery({
    host: services.smtpHost,
    port: services.smtpPort,
    from: "Kithwork <no-reply@kithwork.test>",
    secure: false,
    requireTLS: false,
  });
  const worker = await createEmailWorker({
    redisUrl: services.redisUrl,
    encryptionKey: database.key.toString("base64"),
    prefix,
    concurrency: 2,
    deliver: smtp.deliver,
    deliverOutboxEmail: createOutboxDelivery({
      store,
      encryptionKey: database.key.toString("base64"),
      deliver: smtp.deliver,
      onEvent: () => {},
    }),
    onEvent: () => {},
  });
  try {
    await expect
      .poll(async () => (await queue.getJob(event.id))?.getState())
      .toBe("completed");
    const messages = async () =>
      (await (
        await fetch(
          `${services.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${event.message.to}`)}`,
        )
      ).json()) as { messages: { ID: string }[] };
    await expect.poll(async () => (await messages()).messages.length).toBe(1);
    await (await queue.getJob(event.id))!.remove();
    await publish({ id: event.id, expiresAt: event.expiresAt });
    await expect
      .poll(async () => (await queue.getJob(event.id))?.getState())
      .toBe("completed");
    expect((await messages()).messages).toHaveLength(1);
    expect(
      (
        await database.pool.query(
          "SELECT outcome,payload FROM email_outbox WHERE id=$1",
          [event.id],
        )
      ).rows[0],
    ).toEqual({ outcome: "sent", payload: null });
  } finally {
    await worker.close();
    smtp.close();
  }
});
it("polls independently and stops scheduling before shutdown resolves", async () => {
  const event = await database.event();
  const relay = startOutboxRelay({
    store,
    publish,
    onError: () => {},
    pollIntervalMs: 10,
  });
  try {
    await expect
      .poll(async () => (await queue.getJob(event.id))?.getState())
      .toBe("waiting");
  } finally {
    await relay.close();
  }
  await expect(relay.finished).resolves.toBeUndefined();
});
it("recovers transient poll failures but surfaces programming failures to runtime supervision", async () => {
  const event = await database.event();
  let attempts = 0;
  const relay = startOutboxRelay({
    store: {
      ...store,
      maintain: async () => {
        if (attempts++ === 0)
          throw Object.assign(new Error("connection lost"), {
            code: "ECONNRESET",
          });
        await store.maintain();
      },
    },
    publish,
    onError: () => {},
    pollIntervalMs: 10,
  });
  try {
    await expect
      .poll(async () => (await queue.getJob(event.id))?.getState())
      .toBe("waiting");
  } finally {
    await relay.close();
  }
  const broken = startOutboxRelay({
    store: {
      ...store,
      maintain: () => Promise.reject(new TypeError("programming failure")),
    },
    publish,
    onError: () => {},
  });
  await expect(broken.finished).rejects.toThrow(
    "Outbox relay stopped unexpectedly",
  );
  await expect(broken.close()).rejects.toThrow(
    "Outbox relay stopped unexpectedly",
  );
});
