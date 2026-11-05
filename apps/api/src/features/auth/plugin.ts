import type { FastifyInstance } from "fastify";
import { createEmailProducer } from "@kithwork/email";
import type { ApiConfig } from "../../config.js";
import type { Database } from "../../platform/database/types.js";
import { createAuth } from "./provider.js";
import { registerAuthRoutes } from "./routes.js";
import { registerRpc } from "../../platform/trpc/plugin.js";

export function registerAuthentication(
  app: FastifyInstance,
  config: ApiConfig,
  db: Database,
) {
  app.register(async (authenticatedApp) => {
    const producer = await createEmailProducer({
      redisUrl: config.redisUrl,
      encryptionKey: config.auth.encryptionKey,
      prefix: config.auth.emailQueuePrefix,
      onError: () => app.log.error("Email queue connection failed"),
    });
    authenticatedApp.addHook("onClose", () => producer.close());
    const auth = createAuth({
      config,
      db,
      logger: app.log,
      sendEmail: (message, requestId) =>
        producer.enqueue(message, requestId ? { requestId } : {}),
    });
    registerAuthRoutes(authenticatedApp, auth, config);

    registerRpc(authenticatedApp, config, db, auth);
  });
}
