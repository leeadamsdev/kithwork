import { Queue, QueueEvents, Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import { integrationServices } from "./context.js";
import { uniqueNamespace } from "./fixtures.js";

describe("BullMQ integration", () => {
  const cleanups: (() => Promise<void>)[] = [];
  const errors: Error[] = [];

  afterEach(async () => {
    const results = await Promise.allSettled(
      cleanups.splice(0).map((cleanup) => cleanup()),
    );
    const cleanupErrors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    const failures = [...errors.splice(0), ...cleanupErrors];
    if (failures.length > 0)
      throw new AggregateError(failures, "Queue resource errors");
  });

  async function queueFixture(
    processor: (
      data: { value: number },
      attemptsMade: number,
    ) => number | Promise<number>,
    prefix = uniqueNamespace(),
  ) {
    const producer = new Redis(integrationServices().redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    const consumer = new Redis(integrationServices().redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    const onError = (error: Error) => {
      errors.push(error);
    };
    producer.on("error", onError);
    consumer.on("error", onError);
    const resources: {
      queue?: Queue<{ value: number }, number>;
      events?: QueueEvents;
      worker?: Worker<{ value: number }, number>;
    } = {};
    cleanups.push(async () => {
      const outcomes = await Promise.allSettled([
        resources.worker?.close(),
        resources.events?.close(),
      ]);
      outcomes.push(
        ...(await Promise.allSettled([resources.queue?.obliterate()])),
      );
      outcomes.push(...(await Promise.allSettled([resources.queue?.close()])));
      producer.disconnect();
      consumer.disconnect();
      const failures = outcomes.flatMap((result) =>
        result.status === "rejected" ? [result.reason as unknown] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, "Queue cleanup failed");
    });
    await Promise.all([producer.connect(), consumer.connect()]);
    const queue = (resources.queue = new Queue<{ value: number }, number>(
      "probe",
      { connection: producer, prefix },
    ));
    const events = (resources.events = new QueueEvents("probe", {
      connection: consumer,
      prefix,
    }));
    const worker = (resources.worker = new Worker<{ value: number }, number>(
      "probe",
      async (job) => await processor(job.data, job.attemptsMade),
      { connection: consumer, prefix },
    ));
    queue.on("error", onError);
    events.on("error", onError);
    worker.on("error", onError);
    await Promise.all([
      queue.waitUntilReady(),
      events.waitUntilReady(),
      worker.waitUntilReady(),
    ]);
    return { queue, events };
  }

  it("processes jobs and waits for their completion", async () => {
    const { queue, events } = await queueFixture(({ value }) => value * 2);
    const job = await queue.add("double", { value: 21 });
    expect(await job.waitUntilFinished(events, 5_000)).toBe(42);
  });

  it("retries a deliberately failed attempt and then completes", async () => {
    let calls = 0;
    const { queue, events } = await queueFixture(({ value }, attemptsMade) => {
      calls++;
      if (attemptsMade === 0) throw new Error("deliberate retry");
      return value;
    });
    const job = await queue.add("retry", { value: 7 }, { attempts: 2 });
    expect(await job.waitUntilFinished(events, 5_000)).toBe(7);
    expect(calls).toBe(2);
  });

  it("isolates identical queue and job names through BullMQ prefixes", async () => {
    const first = await queueFixture(() => 1);
    const second = await queueFixture(() => 2);
    const jobs = await Promise.all([
      first.queue.add("same", { value: 0 }, { jobId: "same" }),
      second.queue.add("same", { value: 0 }, { jobId: "same" }),
    ]);
    expect(
      await Promise.all([
        jobs[0]?.waitUntilFinished(first.events, 5_000),
        jobs[1]?.waitUntilFinished(second.events, 5_000),
      ]),
    ).toEqual([1, 2]);
  });
});
