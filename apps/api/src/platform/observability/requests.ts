import type { FastifyInstance } from "fastify";
import { metrics } from "@opentelemetry/api";

export function registerRequestObservability(app: FastifyInstance) {
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
}
