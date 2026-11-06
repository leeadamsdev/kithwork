import { expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

const { fixture: f, invite } = useInvitationFixture();

it("returns unavailable when retention deletes an invitation during resend", async () => {
  const org = await f.create();
  const invitation = await invite(org);
  await f.database.pool.query(
    "UPDATE organisation_invitation SET status='expired',expires_at=now()-interval '31 days',last_issued_at=now()-interval '31 days',updated_at=now()-interval '31 days' WHERE id=$1",
    [invitation.id],
  );
  await f.database.pool.query(
    "UPDATE email_outbox SET payload=null,outcome='skipped',completed_at=now()-interval '8 days' WHERE invitation_id=$1",
    [invitation.id],
  );
  const retention = await f.database.pool.connect();
  let pending: ReturnType<typeof f.mutate> | undefined;
  try {
    await retention.query("BEGIN");
    // Hold the row exactly as the retention sweep does before deleting it.
    await retention.query(
      "SELECT id FROM organisation_invitation WHERE id=$1 FOR UPDATE SKIP LOCKED",
      [invitation.id],
    );
    pending = f.mutate(
      "organisations.invitations.resend",
      { organisationId: org.id, invitationId: invitation.id },
      f.alice,
    );
    await expect
      .poll(
        async () =>
          (
            await f.database.pool.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%organisation_invitation%'",
            )
          ).rows[0]!.count,
        { timeout: 1500, interval: 10 },
      )
      .toBe(1);
    await retention.query("DELETE FROM organisation_invitation WHERE id=$1", [
      invitation.id,
    ]);
    await retention.query("COMMIT");
    const response = await pending;
    expect(response.statusCode, response.body).toBe(404);
    expect(
      (await f.database.pool.query("SELECT id FROM email_outbox")).rowCount,
    ).toBe(0);
  } finally {
    await retention.query("ROLLBACK");
    await pending;
    retention.release();
  }
});
