import { Redis } from "ioredis";
import { beforeAll, afterAll } from "vitest";
import { integrationServices } from "../../context.js";
import { uniqueNamespace } from "../../support/namespace.js";
export function redisFixture() {
  const namespace = uniqueNamespace();
  let client: Redis;
  const keys = new Set<string>();
  const errors: Error[] = [];
  beforeAll(async () => {
    client = new Redis(integrationServices().redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 5_000,
    });
    client.on("error", (error) => {
      errors.push(error);
    });
    await client.connect();
  });
  afterAll(async () => {
    try {
      if (keys.size > 0) await client.del(...keys);
      await client.quit();
    } finally {
      client.disconnect();
    }
    if (errors.length > 0)
      throw new AggregateError(errors, "Unexpected test Redis errors");
  });
  return {
    client: () => client,
    key(name: string) {
      const key = `${namespace}:${name}`;
      keys.add(key);
      return key;
    },
  };
}
