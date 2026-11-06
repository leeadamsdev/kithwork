import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "../../../platform/database/fixtures.js";

it("enforces pending-recipient uniqueness, grant roles and durable outbox invariants", async () => {
  const database = await createTestDatabase({ migrate: true });
  const { pool } = database;
  try {
    const userId = randomUUID(),
      orgId = randomUUID(),
      invitationId = randomUUID();
    await pool.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Issuer','issuer@example.test')",
      [userId],
    );
    await pool.query("INSERT INTO organisation(id,name) VALUES($1,'Team')", [
      orgId,
    ]);
    const values = [invitationId, orgId, userId];
    const insert =
      "INSERT INTO organisation_invitation(id,organisation_id,issuer_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,'recipient@example.test','member',repeat('a',64),now()+interval '7 days')";
    await pool.query(insert, values);
    await expect(
      pool.query(insert, [randomUUID(), orgId, userId]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      pool.query(
        "UPDATE organisation_invitation SET role='owner' WHERE id=$1",
        [invitationId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "UPDATE organisation_invitation SET token_hash='raw-token' WHERE id=$1",
        [invitationId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "UPDATE organisation_invitation SET accepted_at=now() WHERE id=$1",
        [invitationId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const outboxId = randomUUID();
    await pool.query(
      "INSERT INTO email_outbox(id,invitation_id,invitation_version,payload,expires_at) VALUES($1,$2,1,'{}',now()+interval '7 days')",
      [outboxId, invitationId],
    );
    await expect(
      pool.query(
        "UPDATE email_outbox SET outcome='sent',completed_at=now() WHERE id=$1",
        [outboxId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query("UPDATE email_outbox SET delivery_attempts=6 WHERE id=$1", [
        outboxId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "INSERT INTO email_outbox(invitation_id,invitation_version,payload,expires_at) VALUES($1,1,'{}',now()+interval '7 days')",
        [invitationId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await pool.query(
      "UPDATE email_outbox SET outcome='sent',completed_at=now(),payload=null WHERE id=$1",
      [outboxId],
    );
    await pool.query(
      "UPDATE organisation_invitation SET status='revoked' WHERE id=$1",
      [invitationId],
    );
    await pool.query(insert, [randomUUID(), orgId, userId]);
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM auth_user"))
        .rows[0],
    ).toEqual({ count: 1 });
  } finally {
    await database.close();
  }
});

it("rolls back an invitation and its email intent together", async () => {
  const database = await createTestDatabase({ migrate: true });
  const client = await database.pool.connect();
  try {
    const userId = randomUUID(),
      orgId = randomUUID(),
      invitationId = randomUUID();
    await client.query(
      "INSERT INTO auth_user(id,name,email) VALUES($1,'Issuer','issuer@example.test')",
      [userId],
    );
    await client.query("INSERT INTO organisation(id,name) VALUES($1,'Team')", [
      orgId,
    ]);
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO organisation_invitation(id,organisation_id,issuer_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,'recipient@example.test','member',repeat('a',64),now()+interval '7 days')",
      [invitationId, orgId, userId],
    );
    await client.query(
      "INSERT INTO email_outbox(invitation_id,invitation_version,payload,expires_at) VALUES($1,1,'{}',now()+interval '7 days')",
      [invitationId],
    );
    await client.query("ROLLBACK");
    expect(
      (await client.query("SELECT id FROM organisation_invitation")).rowCount,
    ).toBe(0);
    expect((await client.query("SELECT id FROM email_outbox")).rowCount).toBe(
      0,
    );
  } finally {
    client.release();
    await database.close();
  }
});
