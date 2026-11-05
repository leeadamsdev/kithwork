import { createServiceLogs } from "./platform/services/logs.js";
import { startIntegrationContainers } from "./platform/services/containers.js";
import { randomUUID } from "node:crypto";
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
  const logs = createServiceLogs(logDirectory, password);
  const results = await startIntegrationContainers(
    images,
    password,
    logs.capture,
  );

  const started: StartedTestContainer[] = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  async function cleanup() {
    const stopped = await Promise.allSettled(
      started.map((container) => container.stop()),
    );
    const saved = await Promise.allSettled([logs.save()]);
    const errors = [...stopped, ...saved].flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, "Integration resource cleanup failed");
  }

  const [postgres, redis, mailpit] = results;
  if (
    postgres?.status !== "fulfilled" ||
    redis?.status !== "fulfilled" ||
    mailpit?.status !== "fulfilled"
  ) {
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
    mailpitUrl: `http://${mailpit.value.getHost()}:${mailpit.value.getMappedPort(8025)}`,
    smtpHost: mailpit.value.getHost(),
    smtpPort: mailpit.value.getMappedPort(1025),
  } satisfies IntegrationServices);
  return cleanup;
}
