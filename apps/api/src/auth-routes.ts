import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { createAuth } from "./auth.js";
import type { ApiConfig } from "./config.js";
import { z } from "zod";

// Leave room for the origin and signed token in the mail queue's 4096-character URL.
const redirect = z.string().refine((value) => {
  try {
    return encodeURIComponent(value).length <= 2048;
  } catch {
    return false;
  }
});
const authBody = z.looseObject({
  email: z.email().max(254).optional(),
  callbackURL: redirect.optional(),
  redirectTo: redirect.optional(),
  errorCallbackURL: redirect.optional(),
  newUserCallbackURL: redirect.optional(),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof createAuth>,
  config: ApiConfig,
) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    bodyLimit: 16 * 1024,
    config: {
      rateLimit: {
        max: (request) =>
          request.method === "GET"
            ? config.rateLimitMax
            : config.auth.rateLimitMax,
        keyGenerator: (request) =>
          `auth:${request.method === "GET" ? "read" : "write"}:${request.ip}`,
      },
    },
    async handler(request, reply) {
      reply.header("cache-control", "no-store");
      if (
        request.method === "POST" &&
        request.headers["content-type"]?.split(";", 1)[0]?.toLowerCase() !==
          "application/json"
      ) {
        return reply
          .code(415)
          .send({ error: "Unsupported Media Type", requestId: request.id });
      }
      if (
        request.method === "POST" &&
        !authBody.safeParse(request.body).success
      ) {
        return reply.code(400).send({
          error: "Invalid authentication request",
          requestId: request.id,
        });
      }
      const headers = fromNodeHeaders(request.headers);
      headers.set("x-request-id", request.id);
      headers.set("x-kithwork-client-ip", request.ip);
      const url = new URL(config.auth.baseURL);
      const incoming = new URL(request.url, config.auth.baseURL);
      url.pathname = incoming.pathname;
      url.search = incoming.search;
      try {
        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers,
            ...(request.method === "POST"
              ? { body: JSON.stringify(request.body) }
              : {}),
          }),
        );
        if (response.status >= 500) throw new Error("Authentication failed");
        reply.code(response.status);
        response.headers.forEach((value, key) => {
          if (key !== "set-cookie" && key !== "cache-control")
            reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header("set-cookie", cookies);
        return reply.send(response.body ? await response.text() : null);
      } catch {
        request.log.error("Authentication request failed");
        return reply
          .code(500)
          .send({ error: "Authentication unavailable", requestId: request.id });
      }
    },
  });
}
