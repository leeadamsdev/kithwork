import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  TracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import type { ApiConfig } from "../../config.js";
import { apiInfo } from "../../features/system/metadata.js";

export interface TelemetryExporters {
  spanExporter: SpanExporter;
  metricExporter: PushMetricExporter;
}

export function createTelemetryProviders(
  config: Extract<ApiConfig["telemetry"], { enabled: true }>,
  exporters?: TelemetryExporters,
) {
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

  return { traceProvider, meterProvider };
}
