import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import type { Redis } from "ioredis";
import type { ApiConfig } from "../../config.js";

export function registerHttpSecurity(
  app: FastifyInstance,
  config: ApiConfig,
  redis: Redis,
) {
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
}
