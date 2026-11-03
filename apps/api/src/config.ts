import { z } from "zod";

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
    API_RATE_LIMIT_MAX: integer(1, 100000).default(600),
    API_RATE_LIMIT_NAMESPACE: z
      .string()
      .regex(/^[a-zA-Z0-9:_-]+$/)
      .default("kithwork:api:rate-limit:"),
    OTEL_SDK_DISABLED: z.enum(["true", "false"]).default("true"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  })
  .superRefine((env, ctx) => {
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
