import { expect, it } from "vitest";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../../src/app.js";
import { useCommentFixture } from "./fixtures.js";
const { f } = useCommentFixture();
it("requires both comment tables before declaring the API ready", async () => {
  for (const table of ["issue_comment", "issue_comment_event"]) {
    await f.database.pool.query(
      `ALTER TABLE ${table} RENAME TO unavailable_${table}`,
    );
    const app = createApi({
      config: f.config(),
      logger: createLogger("silent"),
    });
    try {
      const error = await app.ready().then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toMatchObject({ code: "42P01" });
    } finally {
      await app.close();
      await f.database.pool.query(
        `ALTER TABLE unavailable_${table} RENAME TO ${table}`,
      );
    }
  }
});
