import { startTelemetry } from "../../../../dist/platform/observability/telemetry.js";
import { parseConfig } from "../../../../dist/config.js";

const config = parseConfig(process.env);
const telemetry = await startTelemetry(config.telemetry);
const [{ createApi }, { createLogger }, { runApi }] = await Promise.all([
  import("../../../../dist/app.js"),
  import("@kithwork/logging"),
  import("../../../../dist/platform/lifecycle/runtime.js"),
]);
const app = createApi({ config, logger: createLogger("info") });
app.get("/finish", (_request, reply) => {
  setImmediate(() => {
    void stop();
  });
  return reply.send({ ok: true });
});
const stop = await runApi(app, config, telemetry.shutdown);
