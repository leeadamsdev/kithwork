import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { GenericContainer, Wait } from "testcontainers";
import type { readServiceImages } from "../../services.js";
import type { createServiceLogs } from "./logs.js";

export function startIntegrationContainers(
  images: Awaited<ReturnType<typeof readServiceImages>>,
  password: string,
  capture: ReturnType<typeof createServiceLogs>["capture"],
) {
  return Promise.allSettled([
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
    new GenericContainer(images.mailpit)
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp("/readyz", 8025))
      .withStartupTimeout(120_000)
      .withLogConsumer(capture("mailpit"))
      .start(),
  ]);
}
