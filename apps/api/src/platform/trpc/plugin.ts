import type { FastifyInstance } from "fastify";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import type { ApiConfig } from "../../config.js";
import type { createAuth } from "../../features/auth/provider.js";
import { appRouter, type AppRouter } from "./router.js";
import { createApiContext } from "./create-context.js";
import type { ApiContext } from "./context.js";
import { registerRpcHttpBoundary } from "./http.js";
import { databaseErrorCode } from "../database/errors.js";

export function registerRpc(
  authenticatedApp: FastifyInstance,
  config: ApiConfig,
  db: ApiContext["db"],
  auth: ReturnType<typeof createAuth>,
) {
  authenticatedApp.register((rpcApp, _options, done) => {
    registerRpcHttpBoundary(rpcApp, config);
    rpcApp.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: {
        router: appRouter,
        maxBatchSize: 10,
        createContext: ({ req }) =>
          createApiContext(req, rpcApp, config, db, auth),
        onError: ({ error, ctx, path }) => {
          if (error.code === "INTERNAL_SERVER_ERROR")
            (ctx?.log ?? authenticatedApp.log).error(
              {
                procedure: path,
                errorCode: error.code,
                databaseCode: databaseErrorCode(error.cause),
              },
              "RPC failed",
            );
        },
      } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
    });
    done();
  });
}
