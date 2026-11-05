export async function runWorker(
  start: () => Promise<{
    close: () => Promise<void>;
    finished?: Promise<void>;
  }>,
  closeSmtp: () => void,
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    fatal: (message: string) => void;
  },
) {
  const settled = Promise.withResolvers<void>();
  let worker: Awaited<ReturnType<typeof start>> | undefined;
  let requested = false;
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    requested = true;
    closing ??= (async () => {
      log.info("Email worker stopping");
      const deadline = setTimeout(() => {
        log.fatal("Worker shutdown deadline exceeded");
        process.exit(1);
      }, 15000);
      try {
        await settled.promise;
        try {
          await worker?.close();
        } finally {
          closeSmtp();
        }
        log.info("Email worker stopped");
      } finally {
        clearTimeout(deadline);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
    })();
    return closing;
  };
  const onSignal = () => {
    void shutdown().catch(() => {
      log.error("Worker shutdown failed");
      process.exitCode = 1;
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    worker = await start();
    void worker.finished?.catch(() => {
      log.error("Worker processing stopped unexpectedly");
      process.exitCode = 1;
      onSignal();
    });
  } catch (error) {
    settled.resolve();
    await shutdown();
    throw error;
  } finally {
    settled.resolve();
  }
  if (requested) await shutdown();
  else log.info("Email worker ready");
  return shutdown;
}
