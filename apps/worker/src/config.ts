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
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_MAX_CONNECTIONS: integer(1, 100).default(5),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
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
    EMAIL_WORKER_CONCURRENCY: integer(1, 20).default(2),
    SMTP_HOST: z.string().min(1).default("127.0.0.1"),
    SMTP_PORT: integer(1, 65535).default(1025),
    SMTP_SECURE: z.enum(["true", "false"]).default("false"),
    SMTP_REQUIRE_TLS: z.enum(["true", "false"]).default("false"),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z
      .string()
      .regex(/^[^\r\n]+$/)
      .default("Kithwork <no-reply@kithwork.test>"),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD))
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_USER", "SMTP_PASSWORD"],
        message: "Provide both SMTP credentials",
      });
    if (
      value.NODE_ENV === "production" &&
      value.SMTP_SECURE !== "true" &&
      value.SMTP_REQUIRE_TLS !== "true"
    )
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_REQUIRE_TLS"],
        message: "TLS required in production",
      });
  });
export function parseWorkerConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid worker configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  const value = parsed.data;
  return {
    databaseUrl: value.DATABASE_URL,
    databaseMaxConnections: value.DATABASE_MAX_CONNECTIONS,
    logLevel: value.LOG_LEVEL,
    redisUrl: value.REDIS_URL,
    encryptionKey: value.MAIL_ENCRYPTION_KEY,
    prefix: value.EMAIL_QUEUE_PREFIX,
    concurrency: value.EMAIL_WORKER_CONCURRENCY,
    smtp: {
      host: value.SMTP_HOST,
      port: value.SMTP_PORT,
      from: value.MAIL_FROM,
      secure: value.SMTP_SECURE === "true",
      requireTLS: value.SMTP_REQUIRE_TLS === "true",
      ...(value.SMTP_USER && value.SMTP_PASSWORD
        ? { auth: { user: value.SMTP_USER, pass: value.SMTP_PASSWORD } }
        : {}),
    },
  };
}
export type WorkerConfig = ReturnType<typeof parseWorkerConfig>;
