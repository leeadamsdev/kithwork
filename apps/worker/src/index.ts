import { createSmtpDelivery } from "@kithwork/email/worker";
import { createWorker } from "./app.js";
import { createLogger } from "@kithwork/logging";
import { parseWorkerConfig } from "./config.js";
import { runWorker } from "./platform/lifecycle/runtime.js";

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
      () => createWorker({ config, log, deliver: smtp.deliver }),
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
