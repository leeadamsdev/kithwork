import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../../config.js";

export async function runApi(
  app: FastifyInstance,
  config: ApiConfig,
  shutdownTelemetry: () => Promise<void>,
) {
  const startupSettled = Promise.withResolvers<void>();
  let shutdownRequested = false;
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    shutdownRequested = true;
    closing ??= (async () => {
      const deadline = setTimeout(() => {
        app.log.fatal("API shutdown deadline exceeded");
        process.exit(1);
      }, 15000);
      try {
        // Let pending startup finish before closing resources or the listener.
        // Closing during onReady otherwise allows listen() to reopen the server.
        await startupSettled.promise;
        try {
          await app.close();
        } finally {
          await shutdownTelemetry();
        }
      } finally {
        clearTimeout(deadline);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
    })();
    return closing;
  };
  const onSignal = () => {
    void shutdown().catch((err: unknown) => {
      app.log.error({ err }, "API shutdown failed");
      process.exitCode = 1;
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    await app.ready();
    if (!shutdownRequested) {
      const address = await app.listen({
        host: config.host,
        port: config.port,
      });
      if (!shutdownRequested) app.log.info({ address }, "API ready");
    }
  } catch (error) {
    startupSettled.resolve();
    await shutdown();
    throw error;
  } finally {
    startupSettled.resolve();
  }
  if (shutdownRequested) await shutdown();
  return shutdown;
}
