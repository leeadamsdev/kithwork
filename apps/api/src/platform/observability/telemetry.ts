import type { ApiConfig } from "../../config.js";
import type { TelemetryExporters } from "./providers.js";

export async function startTelemetry(
  config: ApiConfig["telemetry"],
  exporters?: TelemetryExporters,
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
  // Install module hooks before loading SDKs or instrumentation modules.
  const [
    api,
    { AsyncLocalStorageContextManager },
    { W3CTraceContextPropagator },
    { createTelemetryProviders },
    { registerApiInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/api"),
    import("@opentelemetry/context-async-hooks"),
    import("@opentelemetry/core"),
    import("./providers.js"),
    import("./instrumentation.js"),
  ]);
  const providers = createTelemetryProviders(config, exporters);
  const { traceProvider, meterProvider } = providers;
  const contextManager = new AsyncLocalStorageContextManager().enable();
  api.context.setGlobalContextManager(contextManager);
  api.propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  api.trace.setGlobalTracerProvider(traceProvider);
  api.metrics.setGlobalMeterProvider(meterProvider);
  const unregister = registerApiInstrumentation(providers);
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
