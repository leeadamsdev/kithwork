import { createDatabase } from "@kithwork/database";
import { createEmailProducer } from "@kithwork/email";
import { createEmailWorker } from "@kithwork/email/worker";
import type { createLogger } from "@kithwork/logging";
import type { WorkerConfig } from "./config.js";
import { createOutboxStore } from "./features/outbox/store.js";
import { createOutboxDelivery } from "./features/outbox/delivery.js";
import { startOutboxRelay } from "./features/outbox/relay.js";

export async function createWorker({
  config,
  log,
  deliver,
}: {
  config: WorkerConfig;
  log: ReturnType<typeof createLogger>;
  deliver: Parameters<typeof createEmailWorker>[0]["deliver"];
}) {
  const { db, pool } = createDatabase({
    connectionString: config.databaseUrl,
    maxConnections: config.databaseMaxConnections,
    statementTimeoutMs: 2000,
    onPoolError: () => log.error("Worker database pool error"),
  });
  let producer: Awaited<ReturnType<typeof createEmailProducer>> | undefined;
  let worker: Awaited<ReturnType<typeof createEmailWorker>> | undefined;
  let relay: ReturnType<typeof startOutboxRelay> | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const failures: unknown[] = [];
      for (const stop of [
        () => relay?.close(),
        () => worker?.close(),
        () => producer?.close(),
        () => pool.end(),
      ]) {
        try {
          await stop();
        } catch {
          failures.push(new Error("Worker resource shutdown failed"));
        }
      }
      if (failures.length)
        throw new AggregateError(failures, "Worker resource shutdown failed");
    })());
  try {
    await pool.query(
      "SELECT o.invitation_version,i.version FROM email_outbox o,organisation_invitation i LIMIT 0",
    );
    const store = createOutboxStore(db);
    producer = await createEmailProducer({
      ...config,
      onError: () => log.error("Email queue connection failed"),
    });
    worker = await createEmailWorker({
      ...config,
      deliver,
      deliverOutboxEmail: createOutboxDelivery({
        store,
        encryptionKey: config.encryptionKey,
        deliver,
        onEvent: (event) => {
          if (event.outcome === "failed")
            log.error(event, "Outbox email processing failed");
          else log.info(event, "Outbox email processed");
        },
      }),
      onEvent: (event) => {
        if (event.event === "error" || event.event === "failed")
          log.error(event, "Email processing failed");
        else log.info(event, "Email processed");
      },
    });
    relay = startOutboxRelay({
      store,
      publish: producer.ensureOutboxEmail,
      onError: (event) => log.error(event, "Outbox publication failed"),
    });
    const finished = Promise.race([worker.finished, relay.finished]);
    void finished.catch(() => {});
    return { close, finished };
  } catch {
    await close();
    throw new Error("Worker startup failed");
  }
}
