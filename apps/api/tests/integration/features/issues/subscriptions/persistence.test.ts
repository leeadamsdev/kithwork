import { expect, it } from "vitest";
import { createTestDatabase } from "../../../../../../../tests/integration/platform/database/fixtures.js";
import { seedIssueParticipation } from "../../../../../../../tests/integration/features/issues/participation-fixtures.js";
import { autoFollowIssue } from "../../../../../src/features/issues/subscriptions/commands.js";

it("inserts eligible automatic followers in bulk and preserves an existing mute", async () => {
  const db = await createTestDatabase({ migrate: true });
  try {
    const s = await seedIssueParticipation(db);
    await db.pool.query(
      "INSERT INTO issue_subscription(organisation_id,issue_id,user_id,state) VALUES($1,$2,$3,'muted')",
      [s.org, s.issue, s.bob],
    );
    await db.db.transaction((tx) =>
      autoFollowIssue(tx, { organisationId: s.org, issueId: s.issue }, [
        s.alice,
        s.bob,
      ]),
    );
    expect(
      (
        await db.pool.query(
          "SELECT user_id,state FROM issue_subscription ORDER BY user_id",
        )
      ).rows,
    ).toEqual(
      [
        { user_id: s.alice, state: "watching" },
        { user_id: s.bob, state: "muted" },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    );
  } finally {
    await db.close();
  }
});
