import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseConfig } from "./config.js";
import { startTelemetry } from "./platform/observability/telemetry.js";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

try {
  const config = parseConfig(process.env);
  const telemetry = await startTelemetry(config.telemetry);
  try {
    const [{ createApi }, { createLogger }, { runApi }] = await Promise.all([
      import("./app.js"),
      import("@kithwork/logging"),
      import("./platform/lifecycle/runtime.js"),
    ]);
    const app = createApi({ config, logger: createLogger(config.logLevel) });
    await runApi(app, config, telemetry.shutdown);
  } catch (error) {
    await telemetry.shutdown();
    throw error;
  }
} catch (error) {
  // Startup failures can contain credential-bearing connection strings.
  console.error(
    error instanceof Error &&
      error.message.startsWith("Invalid API configuration")
      ? error.message
      : "API startup failed; verify service availability and configuration.",
  );
  process.exitCode = 1;
}
