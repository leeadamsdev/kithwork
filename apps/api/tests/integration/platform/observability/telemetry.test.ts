import { expect, it } from "vitest";
import { createTestDatabase } from "../../../../../../tests/integration/platform/database/fixtures.js";
import { uniqueNamespace } from "../../../../../../tests/integration/support/namespace.js";
import { integrationServices } from "../../../../../../tests/integration/context.js";
import { startApiProcess } from "../../../fixtures/process.js";
import { createServer } from "node:http";
import { once } from "node:events";

it("exports real HTTP, Fastify, RPC and PostgreSQL spans, correlated logs and bounded metrics", async () => {
  const database = await createTestDatabase({ migrate: true });
  let child: Awaited<ReturnType<typeof startApiProcess>> | undefined;
  try {
    child = await startApiProcess(
      {
        DATABASE_URL: database.connectionString,
        REDIS_URL: integrationServices().redisUrl,
        API_PORT: "0",
        API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
        OTEL_SDK_DISABLED: "false",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
      },
      "telemetry",
    );
    await fetch(`${child.address}/health/live`);
    await fetch(
      `${child.address}/trpc/system.info?input=${encodeURIComponent(JSON.stringify("private-input"))}`,
    );
    await fetch(`${child.address}/database-probe`);
    await fetch(
      `${child.address}/api/auth/reset-password/private-reset-path-marker?callbackURL=${encodeURIComponent("http://127.0.0.1:5173/private-callback-marker")}`,
      { redirect: "manual" },
    );
    await fetch(`${child.address}/finish`);
    expect(await child.exited).toEqual({ code: 0, signal: null });
    const output = child.stdout();
    const report = JSON.parse(
      output.split("\n").find((line) => line.startsWith('{"telemetry":'))!,
    ) as {
      telemetry: {
        spans: {
          name: string;
          traceId: string;
          spanId: string;
          parentSpanId?: string;
          attributes: Record<string, unknown>;
        }[];
        metrics: unknown[];
      };
    };
    const spans = report.telemetry.spans;
    expect(spans.some((span) => span.name === "trpc system.info")).toBe(true);
    expect(spans.some((span) => /pg.*SELECT|pg.*query/i.test(span.name))).toBe(
      true,
    );
    expect(
      spans.some((span) => span.attributes["http.route"] === "/trpc/:path"),
    ).toBe(true);
    const rpc = spans.find((span) => span.name === "trpc system.info")!;
    expect(
      spans.some(
        (span) =>
          span.spanId === rpc.parentSpanId && span.traceId === rpc.traceId,
      ),
    ).toBe(true);
    expect(output).toContain('"trace_id"');
    expect(output).not.toContain("private-input");
    expect(output).not.toContain("private-query-value");
    expect(output).not.toContain("private-reset-path-marker");
    expect(output).not.toContain("private-callback-marker");
    expect(JSON.stringify(report.telemetry.metrics)).toContain(
      "kithwork.http.request.duration",
    );
    expect(JSON.stringify(spans)).not.toContain("/health/live");
    expect(child.stderr()).toBe("");
  } finally {
    await child?.stop();
    await database.close();
  }
});

it("flushes HTTP/protobuf traces and metrics to an OTLP receiver on shutdown", async () => {
  const exports: {
    path: string | undefined;
    contentType: string | undefined;
    body: Buffer;
  }[] = [];
  const receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      exports.push({
        path: request.url,
        contentType: request.headers["content-type"],
        body: Buffer.concat(chunks),
      });
      response
        .writeHead(200, { "content-type": "application/x-protobuf" })
        .end();
    });
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  const address = receiver.address();
  if (!address || typeof address === "string")
    throw new Error("Missing OTLP listener");
  const database = await createTestDatabase({ migrate: true });
  let child: Awaited<ReturnType<typeof startApiProcess>> | undefined;
  try {
    child = await startApiProcess(
      {
        DATABASE_URL: database.connectionString,
        REDIS_URL: integrationServices().redisUrl,
        API_PORT: "0",
        API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
        OTEL_SDK_DISABLED: "false",
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      },
      "telemetry-wire",
    );
    expect((await fetch(`${child.address}/trpc/system.info`)).status).toBe(200);
    await fetch(`${child.address}/finish`);
    expect(await child.exited).toEqual({ code: 0, signal: null });
    expect(exports.map((batch) => batch.path)).toEqual(
      expect.arrayContaining(["/v1/traces", "/v1/metrics"]),
    );
    expect(
      exports.every(
        (batch) =>
          batch.contentType === "application/x-protobuf" &&
          batch.body.length > 0,
      ),
    ).toBe(true);
    expect(
      exports.find((batch) => batch.path === "/v1/traces")!.body.toString(),
    ).toContain("trpc system.info");
    expect(child.stderr()).toBe("");
  } finally {
    await child?.stop();
    await database.close();
    await new Promise<void>((resolve, reject) => {
      receiver.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
