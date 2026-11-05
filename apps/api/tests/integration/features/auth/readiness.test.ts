import { describe, expect, it } from "vitest";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../src/app.js";
import { parseConfig } from "../../../../src/config.js";
import { apiTestEnvironment } from "../../../fixtures/config.js";
import { createTestDatabase } from "../../../../../../tests/integration/platform/database/fixtures.js";
import { uniqueNamespace } from "../../../../../../tests/integration/support/namespace.js";
import { integrationServices } from "../../../../../../tests/integration/context.js";
describe("readiness", () => {
  it("does not announce readiness before authentication migrations exist", async () => {
    const blank = await createTestDatabase();
    const instance = createApi({
      config: parseConfig({
        ...apiTestEnvironment,
        DATABASE_URL: blank.connectionString,
        REDIS_URL: integrationServices().redisUrl,
        EMAIL_QUEUE_PREFIX: uniqueNamespace(),
        API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
      }),
      logger: createLogger("silent"),
    });
    try {
      const error = await instance.ready().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ code: "42P01" });
    } finally {
      await instance.close();
      await blank.close();
    }
  });
});
