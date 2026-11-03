import { startTelemetry } from "../../dist/telemetry.js";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import type {
  PushMetricExporter,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { parseConfig } from "../../dist/config.js";

const spans: {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  attributes: ReadableSpan["attributes"];
}[] = [];
const metrics: ResourceMetrics[] = [];
const spanExporter: SpanExporter = {
  export(batch, callback) {
    spans.push(
      ...batch.map((span) => ({
        name: span.name,
        ...span.spanContext(),
        parentSpanId: span.parentSpanContext?.spanId,
        attributes: span.attributes,
      })),
    );
    callback({ code: 0 });
  },
  shutdown: () => Promise.resolve(),
};
const metricExporter: PushMetricExporter = {
  export(batch, callback) {
    metrics.push(batch);
    callback({ code: 0 });
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};
const config = parseConfig(process.env);
const telemetry = await startTelemetry(config.telemetry, {
  spanExporter,
  metricExporter,
});
const [{ createApi }, { createLogger }, { runApi }, { createDatabase }] =
  await Promise.all([
    import("../../dist/app.js"),
    import("../../dist/logger.js"),
    import("../../dist/runtime.js"),
    import("@kithwork/database"),
  ]);
const app = createApi({ config, logger: createLogger("info") });
const database = createDatabase({
  connectionString: config.databaseUrl,
  onPoolError: (error) => {
    throw error;
  },
});
app.addHook("onClose", async () => {
  await database.pool.end();
});
app.get("/database-probe", async () => {
  await database.pool.query("SELECT $1::text", ["private-query-value"]);
  return { ok: true };
});
app.get("/finish", (_request, reply) => {
  setImmediate(() => {
    void stop().then(() => {
      console.log(JSON.stringify({ telemetry: { spans, metrics } }));
    });
  });
  return reply.send({ ok: true });
});
const stop = await runApi(app, config, telemetry.shutdown);
