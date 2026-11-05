import { expect, it, vi } from "vitest";
import { runWorker } from "../../../../src/platform/lifecycle/runtime.js";

it("coalesces shutdown and closes SMTP after active worker delivery finishes", async () => {
  const release = Promise.withResolvers<void>();
  const closed: string[] = [];
  const messages: string[] = [];
  const shutdown = await runWorker(
    () =>
      Promise.resolve({
        close: async () => {
          await release.promise;
          closed.push("worker");
        },
      }),
    () => {
      closed.push("smtp");
    },
    {
      info: (message: string) => {
        messages.push(message);
      },
      error: () => {},
      fatal: () => {},
    },
  );
  const first = shutdown();
  expect(shutdown()).toBe(first);
  expect(closed).toEqual([]);
  release.resolve();
  await first;
  expect(closed).toEqual(["worker", "smtp"]);
  expect(messages).toEqual([
    "Email worker ready",
    "Email worker stopping",
    "Email worker stopped",
  ]);
});

it("enforces a nonzero hard deadline when delivery cannot finish", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const release = Promise.withResolvers<void>();
  const messages: string[] = [];
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("forced exit");
  });
  const shutdown = await runWorker(
    () => Promise.resolve({ close: () => release.promise }),
    () => {},
    {
      info: () => {},
      error: () => {},
      fatal: (message) => {
        messages.push(message);
      },
    },
  );
  const closing = shutdown();
  try {
    await expect(vi.advanceTimersByTimeAsync(15000)).rejects.toThrow(
      "forced exit",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(messages).toEqual(["Worker shutdown deadline exceeded"]);
  } finally {
    release.resolve();
    await closing;
    exit.mockRestore();
    vi.useRealTimers();
  }
});

it("handles shutdown during startup and disposes a failed startup", async () => {
  const start = Promise.withResolvers<{ close: () => Promise<void> }>();
  const closed: string[] = [];
  const running = runWorker(
    () => start.promise,
    () => {
      closed.push("smtp");
    },
    { info: () => {}, error: () => {}, fatal: () => {} },
  );
  process.emit("SIGTERM", "SIGTERM");
  start.resolve({
    close: () => {
      closed.push("worker");
      return Promise.resolve();
    },
  });
  await running;
  expect(closed).toEqual(["worker", "smtp"]);
  await expect(
    runWorker(
      () => Promise.reject(new Error("start failed")),
      () => {
        closed.push("failed smtp");
      },
      { info: () => {}, error: () => {}, fatal: () => {} },
    ),
  ).rejects.toThrow("start failed");
  expect(closed).toEqual(["worker", "smtp", "failed smtp"]);
});
