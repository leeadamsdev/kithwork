import { expect, it } from "vitest";
import * as transactions from "../../../../src/features/organisations/transaction.js";
import { useIssueFixture } from "./fixtures.js";
const { f } = useIssueFixture();

it("allows shared organisation access concurrently while excluding administration", async () => {
  const org = await f.create();
  const release = Promise.withResolvers<void>();
  let firstEntered = false,
    secondEntered = false;
  const first = transactions.withSharedOrganisationAccess(
    f.database.db,
    f.alice.id,
    org.id,
    async () => {
      firstEntered = true;
      await release.promise;
    },
  );
  let second: Promise<void> | undefined;
  let administration: ReturnType<typeof f.mutate> | undefined;
  try {
    await expect.poll(() => firstEntered).toBe(true);
    second = transactions.withSharedOrganisationAccess(
      f.database.db,
      f.alice.id,
      org.id,
      () => {
        secondEntered = true;
        return Promise.resolve();
      },
    );
    await expect.poll(() => secondEntered, { timeout: 1000 }).toBe(true);
    await second;
    administration = f.mutate(
      "organisations.update",
      { organisationId: org.id, name: "After issues" },
      f.alice,
    );
    await expect
      .poll(
        async () =>
          (
            await f.database.pool.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%from \"organisation\"%'",
            )
          ).rows[0]!.count,
        { timeout: 1500, interval: 10 },
      )
      .toBe(1);
    release.resolve();
    expect((await administration).statusCode).toBe(200);
  } finally {
    release.resolve();
    await first;
    await second;
    await administration;
  }
});
