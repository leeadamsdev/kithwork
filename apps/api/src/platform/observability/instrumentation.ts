import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { safeRequestPath } from "@kithwork/logging/request-path";
import type { createTelemetryProviders } from "./providers.js";

export function registerApiInstrumentation({
  traceProvider,
  meterProvider,
}: ReturnType<typeof createTelemetryProviders>) {
  const querySecrets = [
    "input",
    "sig",
    "Signature",
    "AWSAccessKeyId",
    "X-Goog-Signature",
    "X-Amz-Signature",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
    "token",
    "access_token",
    "password",
    "secret",
    "api_key",
    "code",
    "callbackURL",
    "redirectTo",
    "errorCallbackURL",
    "newUserCallbackURL",
  ];
  const unregister = registerInstrumentations({
    tracerProvider: traceProvider,
    meterProvider,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) =>
          request.url?.split("?", 1)[0]?.startsWith("/health/") ?? false,
        redactedQueryParams: querySecrets,
        redactedQueryParamsServer: querySecrets,
        startIncomingSpanHook: (request) => ({
          "url.path": safeRequestPath(request.url ?? "/"),
        }),
      }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        ignorePaths: (route) => route.url.startsWith("/health/"),
        instrumentHooks: false,
        recordExceptions: false,
        requestHook: (span, request) => {
          span.setAttribute("url.path", safeRequestPath(request.url));
        },
      }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new PinoInstrumentation({ disableLogSending: true }),
    ],
  });

  return unregister;
}
