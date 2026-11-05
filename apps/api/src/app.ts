import Fastify, { LogController, type FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import type { ApiConfig } from "./config.js";
import { registerApiResources } from "./platform/lifecycle/resources.js";
import { registerHttpSecurity } from "./platform/http/security.js";
import { registerHttpErrors } from "./platform/http/errors.js";
import { registerRequestObservability } from "./platform/observability/requests.js";
import { registerHealth } from "./platform/health/routes.js";
import { registerAuthentication } from "./features/auth/plugin.js";

export function createApi({
  config,
  logger,
}: {
  config: ApiConfig;
  logger: FastifyBaseLogger;
}) {
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 10000,
    handlerTimeout: 10000,
    forceCloseConnections: "idle",
    routerOptions: { maxParamLength: 5000 },
  });

  const resources = registerApiResources(app, config);
  registerHttpSecurity(app, config, resources.redis);
  registerRequestObservability(app);
  registerHttpErrors(app);
  registerHealth(app, resources.pool, resources.redis, resources.isDraining);
  registerAuthentication(app, config, resources.db);
  return app;
}
