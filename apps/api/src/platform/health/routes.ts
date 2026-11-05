import type { createDatabase } from "@kithwork/database";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";

const statusSchema = z.toJSONSchema(
  z.object({ status: z.enum(["ok", "ready", "unavailable"]) }),
);

export function registerHealth(
  app: FastifyInstance,
  pool: ReturnType<typeof createDatabase>["pool"],
  redis: Redis,
  isDraining: () => boolean,
) {
  const options = {
    config: { rateLimit: false, otel: false },
    logLevel: "silent" as const,
    schema: { response: { 200: statusSchema, 503: statusSchema } },
  };
  app.get("/health/live", options, (_request, reply) => {
    return reply.header("cache-control", "no-store").send({ status: "ok" });
  });
  app.get(
    "/health/ready",
    { ...options, handlerTimeout: 7000 },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      if (isDraining()) return reply.code(503).send({ status: "unavailable" });
      try {
        const probe = { text: "SELECT 1", query_timeout: 1000 };
        await Promise.all([pool.query(probe), redis.ping()]);
        return { status: "ready" };
      } catch {
        return reply.code(503).send({ status: "unavailable" });
      }
    },
  );
}
