import { expect, it } from "vitest";
import { parseConfig } from "../../../../src/config.js";
import { apiTestEnvironment } from "../../../fixtures/config.js";

it("defaults and bounds independent comment creation/edit budgets", () => {
  const env = {
    ...apiTestEnvironment,
    DATABASE_URL: "postgresql://user:password@localhost/test",
    REDIS_URL: "redis://localhost:6379",
  };
  expect(parseConfig(env)).toMatchObject({
    commentCreationActorRateLimitMax: 60,
    commentCreationOrganisationRateLimitMax: 600,
    commentEditRateLimitMax: 120,
  });
  for (const field of [
    "API_COMMENT_CREATION_ACTOR_RATE_LIMIT_MAX",
    "API_COMMENT_CREATION_ORGANISATION_RATE_LIMIT_MAX",
    "API_COMMENT_EDIT_RATE_LIMIT_MAX",
  ])
    for (const value of ["0", "-1", "100001", "invalid"])
      expect(() => parseConfig({ ...env, [field]: value })).toThrow(
        "Invalid API configuration",
      );
});
