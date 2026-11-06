import { z } from "zod";

const origin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  })
  .transform((value) => new URL(value).origin)
  .pipe(z.string().max(512));

const integer = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: integer(0, 65535).default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_MAX_CONNECTIONS: integer(1, 100).default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    AUTH_SECRET: z.string().min(32),
    AUTH_BASE_URL: origin.default("http://127.0.0.1:3001"),
    WEB_ORIGIN: origin.default("http://127.0.0.1:5173"),
    API_AUTH_RATE_LIMIT_MAX: integer(1, 1000).default(10),
    API_ORGANISATION_CREATION_RATE_LIMIT_MAX: integer(1, 1000).default(5),
    API_INVITATION_SEND_RATE_LIMIT_MAX: integer(1, 1000).default(10),
    API_INVITATION_ACCESS_RATE_LIMIT_MAX: integer(1, 1000).default(30),
    API_TEAM_CREATION_RATE_LIMIT_MAX: integer(1, 1000).default(10),
    API_PROJECT_CREATION_RATE_LIMIT_MAX: integer(1, 1000).default(20),
    API_ISSUE_CREATION_ACTOR_RATE_LIMIT_MAX: integer(1, 100000).default(60),
    API_ISSUE_CREATION_ORGANISATION_RATE_LIMIT_MAX: integer(1, 100000).default(
      300,
    ),
    MAIL_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .refine(
        (value) => Buffer.from(value, "base64").toString("base64") === value,
      ),
    EMAIL_QUEUE_PREFIX: z
      .string()
      .regex(/^[a-zA-Z0-9:_-]+$/)
      .default("kithwork"),
    API_RATE_LIMIT_MAX: integer(1, 100000).default(600),
    API_RATE_LIMIT_NAMESPACE: z
      .string()
      .regex(/^[a-zA-Z0-9:_-]+$/)
      .default("kithwork:api:rate-limit:"),
    OTEL_SDK_DISABLED: z.enum(["true", "false"]).default("true"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      for (const field of ["AUTH_BASE_URL", "WEB_ORIGIN"] as const) {
        if (!env[field].startsWith("https://")) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "HTTPS required in production",
          });
        }
      }
    }
    if (env.OTEL_SDK_DISABLED === "false" && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      ctx.addIssue({
        code: "custom",
        path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
        message: "Required when telemetry is enabled",
      });
    }
  });

export function parseConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Report field names, never supplied URLs, credentials or Zod's input values.
    throw new Error(
      `Invalid API configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  }
  const value = parsed.data;
  return {
    environment: value.NODE_ENV,
    host: value.API_HOST,
    port: value.API_PORT,
    logLevel: value.LOG_LEVEL,
    databaseUrl: value.DATABASE_URL,
    databaseMaxConnections: value.DATABASE_MAX_CONNECTIONS,
    redisUrl: value.REDIS_URL,
    rateLimitMax: value.API_RATE_LIMIT_MAX,
    rateLimitNamespace: value.API_RATE_LIMIT_NAMESPACE,
    organisationCreationRateLimitMax:
      value.API_ORGANISATION_CREATION_RATE_LIMIT_MAX,
    invitationSendRateLimitMax: value.API_INVITATION_SEND_RATE_LIMIT_MAX,
    invitationAccessRateLimitMax: value.API_INVITATION_ACCESS_RATE_LIMIT_MAX,
    teamCreationRateLimitMax: value.API_TEAM_CREATION_RATE_LIMIT_MAX,
    projectCreationRateLimitMax: value.API_PROJECT_CREATION_RATE_LIMIT_MAX,
    issueCreationActorRateLimitMax:
      value.API_ISSUE_CREATION_ACTOR_RATE_LIMIT_MAX,
    issueCreationOrganisationRateLimitMax:
      value.API_ISSUE_CREATION_ORGANISATION_RATE_LIMIT_MAX,
    auth: {
      secret: value.AUTH_SECRET,
      baseURL: value.AUTH_BASE_URL,
      webOrigin: value.WEB_ORIGIN,
      rateLimitMax: value.API_AUTH_RATE_LIMIT_MAX,
      encryptionKey: value.MAIL_ENCRYPTION_KEY,
      emailQueuePrefix: value.EMAIL_QUEUE_PREFIX,
    },
    telemetry:
      value.OTEL_SDK_DISABLED === "false"
        ? {
            enabled: true as const,
            endpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT!,
          }
        : { enabled: false as const },
  };
}

export type ApiConfig = ReturnType<typeof parseConfig>;
