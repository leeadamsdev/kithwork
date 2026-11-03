import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";
import type { IntegrationServices } from "./context.js";
import { readServiceImages } from "./services.js";

export default async function setup(project: TestProject) {
  const images = await readServiceImages();
  const password = randomUUID();
  const runId = randomUUID();
  const logDirectory = resolve("test-results/integration", runId);
  const logs = new Map<string, string>();
  const capture = (name: string) => (stream: NodeJS.ReadableStream) => {
    stream.on("data", (chunk: Buffer) => {
      logs.set(
        name,
        ((logs.get(name) ?? "") + chunk.toString()).slice(-64_000),
      );
    });
  };
  const results = await Promise.allSettled([
    new PostgreSqlContainer(images.postgres)
      .withDatabase("kithwork_test")
      .withUsername("kithwork_test")
      .withPassword(password)
      .withEnvironment({
        POSTGRES_INITDB_ARGS:
          "--auth-host=scram-sha-256 --auth-local=scram-sha-256",
      })
      .withStartupTimeout(120_000)
      .withLogConsumer(capture("postgres"))
      .start(),
    new RedisContainer(images.redis)
      .withPassword(password)
      .withCommand([
        "redis-server",
        "--appendonly",
        "yes",
        "--appendfsync",
        "everysec",
        "--maxmemory-policy",
        "noeviction",
      ])
      .withStartupTimeout(120_000)
      .withLogConsumer(capture("redis"))
      .start(),
  ]);

  const started: StartedTestContainer[] = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  async function cleanup() {
    const stopped = await Promise.allSettled(
      started.map((container) => container.stop()),
    );
    const saved = await Promise.allSettled([
      (async () => {
        await mkdir(logDirectory, { recursive: true });
        await Promise.all(
          [...logs].map(([name, contents]) =>
            writeFile(
              resolve(logDirectory, `${name}.log`),
              contents.replaceAll(password, "[redacted]"),
            ),
          ),
        );
      })(),
    ]);
    const errors = [...stopped, ...saved].flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, "Integration resource cleanup failed");
  }

  const [postgres, redis] = results;
  if (postgres?.status !== "fulfilled" || redis?.status !== "fulfilled") {
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    const cleanupResult = await Promise.allSettled([cleanup()]);
    errors.push(
      ...cleanupResult.flatMap((result) =>
        result.status === "rejected" ? [result.reason as unknown] : [],
      ),
    );
    throw new AggregateError(
      errors,
      `Integration services could not start; check Docker and ${logDirectory}`,
    );
  }

  project.provide("services", {
    postgresUrl: postgres.value.getConnectionUri(),
    redisUrl: redis.value.getConnectionUrl(),
  } satisfies IntegrationServices);
  return cleanup;
}
