import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config.js";

export function registerRpcHttpBoundary(
  app: FastifyInstance,
  config: ApiConfig,
) {
  const origins = new Set([config.auth.webOrigin, config.auth.baseURL]);
  app.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("cache-control", "no-store");
    done(null, payload);
  });
  app.addHook("preHandler", (request, reply, done) => {
    if (request.method !== "POST") return done();
    if (
      request.headers["content-type"]
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      void reply
        .code(415)
        .send({ error: "Unsupported Media Type", requestId: request.id });
      return;
    }
    if (!request.headers.origin || !origins.has(request.headers.origin)) {
      void reply
        .code(403)
        .send({ error: "Untrusted request origin", requestId: request.id });
      return;
    }
    done();
  });
}
