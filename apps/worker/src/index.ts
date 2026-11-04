import { createEmailWorker, createSmtpDelivery } from "@kithwork/email/worker";
import { createLogger } from "@kithwork/logging";
import { parseWorkerConfig } from "./config.js";
import { runWorker } from "./runtime.js";

try {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const config = parseWorkerConfig(process.env);
  const log = createLogger(config.logLevel).child({
    service: "kithwork-worker",
  });
  const smtp = createSmtpDelivery({
    ...config.smtp,
    maxConnections: config.concurrency,
  });
  try {
    await runWorker(
      () =>
        createEmailWorker({
          ...config,
          deliver: smtp.deliver,
          onEvent: (event) => {
            if (event.event === "error" || event.event === "failed")
              log.error(event, "Email processing failed");
            else log.info(event, "Email processed");
          },
        }),
      smtp.close,
      log,
    );
  } catch {
    smtp.close();
    throw new Error("Worker startup failed");
  }
} catch (error) {
  console.error(
    error instanceof Error &&
      error.message.startsWith("Invalid worker configuration:")
      ? error.message
      : "Worker startup failed",
  );
  process.exitCode = 1;
}
