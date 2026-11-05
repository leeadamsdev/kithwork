import Fastify, { LogController, type FastifyBaseLogger } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { fromNodeHeaders } from "better-auth/node";
import { createEmailProducer } from "@kithwork/email";
import { entityIdSchema } from "@kithwork/contracts";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { createDatabase } from "@kithwork/database";
import { metrics } from "@opentelemetry/api";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { ApiConfig } from "./config.js";
import { registerHealth } from "./health.js";
import { appRouter, type AppRouter } from "./trpc/router.js";
import { createAuth } from "./auth/provider.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { TRPCError } from "@trpc/server";
import { registerRpcHttpBoundary } from "./trpc/http.js";
import { databaseErrorCode } from "./database-error.js";

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
  const { db, pool } = createDatabase({
    connectionString: config.databaseUrl,
    maxConnections: config.databaseMaxConnections,
    onPoolError: (err) => {
      app.log.error({ err }, "Database pool error");
    },
  });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1000,
    autoResendUnfulfilledCommands: false,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
  });
  redis.on("error", (err: Error) => {
    app.log.error({ err }, "Redis connection error");
  });
  let draining = false;
  app.addHook("preClose", (done) => {
    draining = true;
    done();
  });
  app.addHook("onClose", async () => {
    const results = await Promise.allSettled([
      pool.end(),
      (async () => {
        try {
          if (redis.status === "ready") await redis.quit();
        } finally {
          redis.disconnect();
        }
      })(),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result): unknown => result.reason),
        "API resource shutdown failed",
      );
  });
  app.addHook("onReady", async () => {
    const probe = {
      text: "SELECT 1 FROM auth_user, organisation, organisation_member LIMIT 0",
      query_timeout: 1000,
    };
    await Promise.all([pool.query(probe), redis.ping()]);
  });
  app.register(helmet, {
    ...(config.environment !== "production"
      ? {
          strictTransportSecurity: false,
          contentSecurityPolicy: {
            directives: { upgradeInsecureRequests: null },
          },
        }
      : {}),
  });
  app.register(rateLimit, {
    redis,
    nameSpace: config.rateLimitNamespace,
    max: config.rateLimitMax,
    timeWindow: 60000,
    skipOnError: false,
  });
  app.register(cors, {
    origin: (origin, done) => done(null, origin === config.auth.webOrigin),
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 600,
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  const duration = metrics
    .getMeter("kithwork-api")
    .createHistogram("kithwork.http.request.duration", {
      unit: "s",
      advice: {
        explicitBucketBoundaries: [
          0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
        ],
      },
    });
  app.addHook("onResponse", async (request, reply) => {
    // In-flight requests can become idle after close() reaps the existing idle sockets.
    if (draining) app.server.closeIdleConnections();
    if (request.routeOptions.url?.startsWith("/health/")) return;
    duration.record(reply.elapsedTime / 1000, {
      "http.route": request.routeOptions.url ?? "unmatched",
      "http.request.method": request.method,
      "http.response.status_code": reply.statusCode,
    });
    request.log.info(
      { req: request, res: reply, responseTime: reply.elapsedTime },
      "Request completed",
    );
  });
  app.setErrorHandler(
    (error: Error & { statusCode?: number }, request, reply) => {
      const status =
        error.statusCode && error.statusCode >= 400 && error.statusCode < 500
          ? error.statusCode
          : 500;
      if (status >= 500) request.log.error({ err: error }, "Request failed");
      const message =
        status === 429
          ? "Too Many Requests"
          : status === 413
            ? "Payload Too Large"
            : status >= 500
              ? "Internal Server Error"
              : "Bad Request";
      return reply.code(status).send({ error: message, requestId: request.id });
    },
  );
  app.after((error) => {
    if (error) throw error;
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) =>
      reply.code(404).send({ error: "Not Found", requestId: request.id }),
    );
  });
  registerHealth(app, pool, redis, () => draining);
  app.register(async (authenticatedApp) => {
    await redis.connect();
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
    authenticatedApp.register((rpcApp, _options, done) => {
      registerRpcHttpBoundary(rpcApp, config);
      rpcApp.register(fastifyTRPCPlugin, {
        prefix: "/trpc",
        trpcOptions: {
          router: appRouter,
          maxBatchSize: 10,
          createContext: async ({ req }) => {
            const session = await auth.api
              .getSession({
                headers: fromNodeHeaders(req.headers),
                query: { disableRefresh: true },
              })
              .catch(() => {
                req.log.error("Authentication session lookup failed");
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: "Session unavailable",
                });
              });
            const user =
              session?.user.emailVerified === true
                ? {
                    id: entityIdSchema.parse(session.user.id),
                    name: session.user.name,
                    email: session.user.email,
                    emailVerified: true as const,
                  }
                : null;
            return {
              requestId: req.id,
              log: req.log,
              db,
              user,
              consumeOrganisationCreationLimit: async (actorId: string) => {
                const limit = rpcApp.createRateLimit({
                  max: config.organisationCreationRateLimitMax,
                  timeWindow: 60000,
                  keyGenerator: () => `organisation:create:${actorId}`,
                });
                const result = await limit(req);
                if (!result.isAllowed && result.isExceeded)
                  throw new TRPCError({
                    code: "TOO_MANY_REQUESTS",
                    message: "Organisation creation rate limit exceeded",
                  });
              },
            };
          },
          onError: ({ error, ctx, path }) => {
            if (error.code === "INTERNAL_SERVER_ERROR")
              (ctx?.log ?? app.log).error(
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
  });
  return app;
}
