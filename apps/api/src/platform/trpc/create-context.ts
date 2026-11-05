import { fromNodeHeaders } from "better-auth/node";
import { entityIdSchema } from "@kithwork/contracts";
import { TRPCError } from "@trpc/server";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { createAuth } from "../../features/auth/provider.js";
import type { ApiConfig } from "../../config.js";
import type { ApiContext } from "./context.js";
export async function createApiContext(
  req: FastifyRequest,
  rpcApp: FastifyInstance,
  config: ApiConfig,
  db: ApiContext["db"],
  auth: ReturnType<typeof createAuth>,
): Promise<ApiContext> {
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
}
