import { createLogger } from "@kithwork/logging";
import { expect, it } from "vitest";
import { createApi } from "../../../../../src/app.js";
import { useOrganisationFixture } from "../../organisations/fixtures.js";
const f = useOrganisationFixture();

it("fails startup when participation tables or the legacy-conversion column are missing", async () => {
  for (const table of ["issue_comment_mention", "issue_subscription"]) {
    const app = createApi({
      config: f.config(),
      logger: createLogger("silent"),
    });
    await f.database.pool.query(
      `ALTER TABLE ${table} RENAME TO missing_participation_probe`,
    );
    try {
      const failure = await app.ready().then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: "42P01" });
    } finally {
      await f.database.pool.query(
        `ALTER TABLE missing_participation_probe RENAME TO ${table}`,
      );
      await app.close();
    }
  }
  const app = createApi({ config: f.config(), logger: createLogger("silent") });
  await f.database.pool.query(
    "ALTER TABLE issue_comment RENAME COLUMN mentions_initialised TO missing_participation_probe",
  );
  try {
    const failure = await app.ready().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "42703" });
  } finally {
    await f.database.pool.query(
      "ALTER TABLE issue_comment RENAME COLUMN missing_participation_probe TO mentions_initialised",
    );
    await app.close();
  }
});
