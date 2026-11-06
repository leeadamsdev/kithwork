import type { FastifyInstance } from "fastify";
import { createDatabase } from "@kithwork/database";
import { Redis } from "ioredis";
import type { ApiConfig } from "../../config.js";

export function registerApiResources(app: FastifyInstance, config: ApiConfig) {
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
  app.register(async () => {
    await redis.connect();
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
      text: "SELECT 1 FROM auth_user, organisation, organisation_member, organisation_invitation, email_outbox, team, team_member, project, project_team LIMIT 0",
      query_timeout: 1000,
    };
    await Promise.all([pool.query(probe), redis.ping()]);
  });

  app.addHook("onResponse", (_request, _reply, done) => {
    // In-flight requests can become idle after close() reaps the existing idle sockets.
    if (draining) app.server.closeIdleConnections();
    done();
  });
  return { db, pool, redis, isDraining: () => draining };
}
