import type { ApiConfig } from "./config.js";
import type { SpanExporter } from "@opentelemetry/sdk-trace";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";

export async function startTelemetry(
  config: ApiConfig["telemetry"],
  exporters?: {
    spanExporter: SpanExporter;
    metricExporter: PushMetricExporter;
  },
) {
  if (!config.enabled) return { shutdown: () => Promise.resolve() };
  const { register } = await import("import-in-the-middle/register-hooks.mjs");
  register({
    include: [
      "http",
      "https",
      "node:http",
      "node:https",
      "pg",
      "pg-pool",
      "pino",
      "fastify",
    ],
  });
  const [
    api,
    { AsyncLocalStorageContextManager },
    { W3CTraceContextPropagator },
    { registerInstrumentations },
    { HttpInstrumentation },
    { PgInstrumentation },
    { PinoInstrumentation },
    { FastifyOtelInstrumentation },
    { resourceFromAttributes },
    { TracerProvider, BatchSpanProcessor },
    { MeterProvider, PeriodicExportingMetricReader },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { apiInfo },
  ] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/context-async-hooks"),
    import("@opentelemetry/core"),
    import("@opentelemetry/instrumentation"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/instrumentation-pino"),
    import("@fastify/otel"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/sdk-trace"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/exporter-metrics-otlp-proto"),
    import("./metadata.js"),
  ]);
  const resource = resourceFromAttributes({
    "service.name": apiInfo.name,
    "service.version": apiInfo.version,
  });
  const endpoint = config.endpoint.replace(/\/$/, "");
  const traceProvider = new TracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor({
        exporter:
          exporters?.spanExporter ??
          new OTLPTraceExporter({
            url: `${endpoint}/v1/traces`,
            timeoutMillis: 2000,
          }),
        exportTimeoutMillis: 2500,
      }),
    ],
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter:
          exporters?.metricExporter ??
          new OTLPMetricExporter({
            url: `${endpoint}/v1/metrics`,
            timeoutMillis: 2000,
          }),
        exportIntervalMillis: 30000,
        exportTimeoutMillis: 2500,
      }),
    ],
  });
  const contextManager = new AsyncLocalStorageContextManager().enable();
  api.context.setGlobalContextManager(contextManager);
  api.propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  api.trace.setGlobalTracerProvider(traceProvider);
  api.metrics.setGlobalMeterProvider(meterProvider);
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
      }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        ignorePaths: (route) => route.url.startsWith("/health/"),
        instrumentHooks: false,
        recordExceptions: false,
        requestHook: (span, request) => {
          span.setAttribute("url.path", request.url.split("?", 1)[0] ?? "/");
        },
      }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new PinoInstrumentation({ disableLogSending: true }),
    ],
  });
  let closing: Promise<void> | undefined;
  const shutdown = async () => {
    try {
      const results = await Promise.allSettled([
        traceProvider.shutdown(),
        meterProvider.shutdown(),
      ]);
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length)
        throw new AggregateError(
          failures.map((result): unknown => result.reason),
          "Telemetry shutdown failed",
        );
    } finally {
      unregister();
      contextManager.disable();
      api.trace.disable();
      api.metrics.disable();
      api.context.disable();
      api.propagation.disable();
    }
  };
  return { shutdown: () => (closing ??= shutdown()) };
}
