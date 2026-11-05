import type { FastifyInstance } from "fastify";

export function registerHttpErrors(app: FastifyInstance) {
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
  // Register the root fallback after the security plugins install rate limiting.
  app.register((_scope, _options, done) => {
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) =>
      reply.code(404).send({ error: "Not Found", requestId: request.id }),
    );
    done();
  });
}
