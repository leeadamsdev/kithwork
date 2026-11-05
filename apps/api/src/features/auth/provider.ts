import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { authSchema, type createDatabase } from "@kithwork/database";
import type { EmailMessage } from "@kithwork/email";
import type { ApiConfig } from "../../config.js";
import type { FastifyBaseLogger } from "fastify";

const linkLifetimeSeconds = 3600;

export function createAuth({
  config,
  db,
  sendEmail,
  logger,
}: {
  config: ApiConfig;
  db: ReturnType<typeof createDatabase>["db"];
  sendEmail: (message: EmailMessage, requestId?: string) => Promise<unknown>;
  logger: FastifyBaseLogger;
}) {
  const send = (
    kind: "verification" | "password-reset",
    to: string,
    url: string,
    request?: Request,
  ) =>
    sendEmail(
      {
        kind,
        to,
        url,
        expiresAt: Date.now() + linkLifetimeSeconds * 1000,
      },
      request?.headers.get("x-request-id") ?? undefined,
    ).then(() => {});
  return betterAuth({
    appName: "Kithwork",
    baseURL: config.auth.baseURL,
    basePath: "/api/auth",
    secret: config.auth.secret,
    trustedOrigins: [config.auth.webOrigin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: linkLifetimeSeconds,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }, request) =>
        send("password-reset", user.email, url, request),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: linkLifetimeSeconds,
      sendVerificationEmail: ({ user, url }, request) =>
        send("verification", user.email, url, request),
    },
    session: {
      expiresIn: 7 * 86400,
      updateAge: 86400,
      cookieCache: { enabled: false },
    },
    verification: { storeIdentifier: "hashed" },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: "uuid" },
      cookiePrefix: "kithwork",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: ["x-kithwork-client-ip"] },
    },
    // Fastify enforces atomic, shared Redis limits before authentication executes.
    rateLimit: { enabled: false },
    // Provider error arguments can contain passwords, tokens or SQL parameters.
    // The HTTP boundary records failures safely with its request correlation ID.
    logger: {
      level: "warn",
      log: (level) => logger[level]("Authentication provider event"),
    },
    // Let the sanitized HTTP boundary handle unexpected failures instead of
    // Better Call's fallback console logger, which prints raw SQL parameters.
    onAPIError: { throw: true },
    telemetry: { enabled: false },
  });
}
