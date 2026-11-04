import type { Job, Queue } from "bullmq";
import type { Redis } from "ioredis";
import { z } from "zod";

const expirySchema = z.object({ sealed: z.object({ expiresAt: z.number() }) });

export async function scrubFailedEmail(job: Job<unknown>) {
  if (
    typeof job.data === "object" &&
    job.data !== null &&
    Object.keys(job.data).length > 0 &&
    (await job.getState()) === "failed"
  ) {
    await job.updateData({});
  }
}

export function createEmailMaintenance(
  queue: Queue<unknown>,
  redis: Redis,
  intervalMs: number,
  onError: () => void,
) {
  const offsets = new Map<string, number>();
  let running: Promise<void> | undefined;
  const sweep = async () => {
    // Advance bounded pages so unexpired jobs at the head cannot hide later expired links.
    for (const state of ["wait", "delayed", "paused", "failed"] as const) {
      const offset = offsets.get(state) ?? 0;
      // BullMQ 6's public JobType excludes paused, so read its Redis list explicitly.
      const page =
        state === "paused"
          ? await Promise.all(
              (
                await redis.lrange(queue.toKey("paused"), offset, offset + 99)
              ).map((id) => queue.getJob(id)),
            )
          : await queue.getJobs([state], offset, offset + 99, true);
      const jobs = page.filter((job) => job !== undefined);
      let removed = 0;
      for (const job of jobs) {
        if (state === "failed") {
          await scrubFailedEmail(job);
          continue;
        }
        const parsed = expirySchema.safeParse(job.data);
        if (parsed.success && parsed.data.sealed.expiresAt <= Date.now()) {
          try {
            await job.remove();
            removed++;
          } catch {
            // A worker may have claimed or completed the job since this page was read.
            const current = await job.getState();
            if (
              current !== "active" &&
              current !== "completed" &&
              current !== "unknown"
            )
              throw new Error("Email cleanup failed");
          }
        }
      }
      offsets.set(
        state,
        jobs.length < 100 ? 0 : Math.max(0, offset + jobs.length - removed),
      );
    }
    // BullMQ's age-based removal is otherwise lazy when a queue becomes idle.
    await queue.clean(86400000, 1000, "completed");
    await queue.clean(86400000, 1000, "failed");
  };
  const run = () => {
    running ??= sweep()
      .catch(onError)
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}
