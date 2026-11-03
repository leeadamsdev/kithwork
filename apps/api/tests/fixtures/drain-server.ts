import { createApi } from "../../dist/app.js";
import { parseConfig } from "../../dist/config.js";
import { createLogger } from "../../dist/logger.js";
import { runApi } from "../../dist/runtime.js";
import { setTimeout as delay } from "node:timers/promises";

const config = parseConfig(process.env);
const app = createApi({ config, logger: createLogger("info") });
app.get("/slow", async (request) => {
  request.log.info("Slow request started");
  await delay(150);
  return { ok: true };
});
await runApi(app, config, async () => {});
