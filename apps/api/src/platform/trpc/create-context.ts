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
  const consume = async (key: string, max: number, message: string) => {
    const limit = rpcApp.createRateLimit({
      max,
      timeWindow: 60000,
      keyGenerator: () => key,
    });
    const result = await limit(req);
    if (!result.isAllowed && result.isExceeded)
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
  };
  return {
    requestId: req.id,
    log: req.log,
    db,
    user,
    invitationEmail: {
      encryptionKey: config.auth.encryptionKey,
      webOrigin: config.auth.webOrigin,
    },
    consumeOrganisationCreationLimit: (actorId: string) =>
      consume(
        `organisation:create:${actorId}`,
        config.organisationCreationRateLimitMax,
        "Organisation creation rate limit exceeded",
      ),
    consumeInvitationSendLimit: async (
      actorId: string,
      organisationId: string,
    ) => {
      await consume(
        `invitation:send:actor:${actorId}`,
        config.invitationSendRateLimitMax,
        "Invitation sending rate limit exceeded",
      );
      await consume(
        `invitation:send:organisation:${organisationId.toLowerCase()}`,
        config.invitationSendRateLimitMax,
        "Invitation sending rate limit exceeded",
      );
    },
    consumeInvitationAccessLimit: (actorId: string) =>
      consume(
        `invitation:access:${actorId}`,
        config.invitationAccessRateLimitMax,
        "Invitation access rate limit exceeded",
      ),
    consumeTeamCreationLimit: async (
      actorId: string,
      organisationId: string,
    ) => {
      await consume(
        `team:create:actor:${actorId}`,
        config.teamCreationRateLimitMax,
        "Team creation rate limit exceeded",
      );
      await consume(
        `team:create:organisation:${organisationId.toLowerCase()}`,
        config.teamCreationRateLimitMax,
        "Team creation rate limit exceeded",
      );
    },
    consumeProjectCreationLimit: async (
      actorId: string,
      organisationId: string,
    ) => {
      await consume(
        `project:create:actor:${actorId}`,
        config.projectCreationRateLimitMax,
        "Project creation rate limit exceeded",
      );
      await consume(
        `project:create:organisation:${organisationId.toLowerCase()}`,
        config.projectCreationRateLimitMax,
        "Project creation rate limit exceeded",
      );
    },
    consumeIssueCreationLimit: async (
      actorId: string,
      organisationId: string,
    ) => {
      await consume(
        `issue:create:actor:${actorId.toLowerCase()}`,
        config.issueCreationActorRateLimitMax,
        "Issue creation rate limit exceeded",
      );
      await consume(
        `issue:create:organisation:${organisationId.toLowerCase()}`,
        config.issueCreationOrganisationRateLimitMax,
        "Issue creation rate limit exceeded",
      );
    },
  };
}
