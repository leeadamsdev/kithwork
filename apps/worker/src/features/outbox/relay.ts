import { setTimeout as sleep } from "node:timers/promises";
import { publishOutboxBatch, type RelayOptions } from "./publisher.js";
import { retryableDatabaseError } from "./database-errors.js";
export function startOutboxRelay(options: RelayOptions) {
  const controller = new AbortController();
  const interval = options.pollIntervalMs ?? 1000;
  const finished = (async () => {
    let wait = interval,
      nextMaintenance = 0;
    while (!controller.signal.aborted) {
      try {
        if (Date.now() >= nextMaintenance) {
          await options.store.maintain();
          nextMaintenance = Date.now() + 60_000;
        }
        const count = await publishOutboxBatch(options, controller.signal);
        wait = count
          ? interval
          : Math.min(Math.max(interval, wait * 2), 10_000);
      } catch (error) {
        if (!retryableDatabaseError(error))
          throw new Error("Outbox relay stopped unexpectedly", {
            cause: error,
          });
        options.onError({ phase: "poll" });
        wait = Math.min(Math.max(interval, wait * 2), 10_000);
      }
      if (!controller.signal.aborted) {
        try {
          await sleep(wait, undefined, {
            signal: controller.signal,
            ref: false,
          });
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
      }
    }
  })();
  // The runtime supervises finished; attaching a handler also covers startup/shutdown races.
  void finished.catch(() => {});
  return {
    finished,
    async close() {
      controller.abort();
      await finished;
    },
  };
}
