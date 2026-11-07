import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTestDatabase } from "../../../platform/database/fixtures.js";
import { seedIssueParticipation } from "../participation-fixtures.js";

it("enforces exact participation scope, membership lifetime and retained mention identity", async () => {
  const db = await createTestDatabase({ migrate: true });
  try {
    const s = await seedIssueParticipation(db);
    const following =
      "INSERT INTO issue_subscription(organisation_id,issue_id,user_id,state) VALUES($1,$2,$3,$4)";
    await db.pool.query(following, [s.org, s.issue, s.bob, "muted"]);
    await expect(
      db.pool.query(following, [s.otherOrg, s.issue, s.bob, "watching"]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query(following, [s.org, s.issue, randomUUID(), "watching"]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query(following, [s.org, s.issue, s.bob, "watching"]),
    ).rejects.toMatchObject({ code: "23505" });
    const mention =
      "INSERT INTO issue_comment_mention(organisation_id,issue_id,comment_id,user_id,first_mentioned_version) VALUES($1,$2,$3,$4,$5)";
    await db.pool.query(mention, [s.org, s.issue, s.comment, s.bob, 1]);
    await expect(
      db.pool.query(mention, [s.otherOrg, s.issue, s.comment, s.carol, 1]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query(mention, [s.org, randomUUID(), s.comment, s.carol, 1]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.pool.query(mention, [s.org, s.issue, s.comment, s.carol, 0]),
    ).rejects.toMatchObject({ code: "23514" });
    await db.pool.query("UPDATE issue SET assignee_id=null WHERE id=$1", [
      s.issue,
    ]);
    await db.pool.query(
      "DELETE FROM organisation_member WHERE organisation_id=$1 AND user_id=$2",
      [s.org, s.bob],
    );
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM issue_subscription WHERE user_id=$1",
          [s.bob],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await db.pool.query(
          "SELECT user_id,first_mentioned_version FROM issue_comment_mention",
        )
      ).rows,
    ).toEqual([{ user_id: s.bob, first_mentioned_version: 1 }]);
    await db.pool.query("DELETE FROM issue_comment WHERE id=$1", [s.comment]);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM issue_comment_mention",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    await db.close();
  }
});
