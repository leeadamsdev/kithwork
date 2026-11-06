import { createLogger } from "@kithwork/logging";
import { expect, it } from "vitest";
import { createApi } from "../../../../src/app.js";
import { useWorkflowFixture } from "./fixtures.js";
const { f } = useWorkflowFixture();

it("requires workflow tables before announcing readiness", async () => {
  for (const table of ["team_workflow", "workflow_status"]) {
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
