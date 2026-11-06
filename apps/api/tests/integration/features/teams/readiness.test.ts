import { createLogger } from "@kithwork/logging";
import { expect, it } from "vitest";
import { createApi } from "../../../../src/app.js";
import { useTeamFixture } from "./fixtures.js";
const { f } = useTeamFixture();
it("requires both team tables before announcing readiness", async () => {
  for (const table of ["team", "team_member"]) {
    await f.database.pool.query(
      `ALTER TABLE ${table} RENAME TO unavailable_${table}`,
    );
    const instance = createApi({
      config: f.config(),
      logger: createLogger("silent"),
    });
    try {
      const error = await instance.ready().then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toMatchObject({ code: "42P01" });
    } finally {
      await instance.close();
      await f.database.pool.query(
        `ALTER TABLE unavailable_${table} RENAME TO ${table}`,
      );
    }
  }
});
