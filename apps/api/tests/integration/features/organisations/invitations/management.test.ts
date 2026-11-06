import { invitationPageSchema } from "@kithwork/contracts";
import { describe, expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

describe("invitation administration", () => {
  const { fixture: f, invite, mail } = useInvitationFixture();
  it("paginates only the selected tenant and computes expired status without writing on reads", async () => {
    const org = await f.create();
    const other = await f.create(f.bob);
    const first = await invite(org);
    await invite(org);
    await invite(other, { actor: f.bob });
    await f.database.pool.query(
      "UPDATE organisation_invitation SET expires_at=now()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await f.query(
        "organisations.invitations.list",
        { organisationId: org.id, limit: 1, ...(cursor ? { cursor } : {}) },
        f.alice,
      );
      expect(response.statusCode, response.body).toBe(200);
      const page = invitationPageSchema.parse(f.data<unknown>(response));
      for (const item of page.items) {
        expect(item.organisationId).toBe(org.id);
        if (item.id === first.id) expect(item.status).toBe("expired");
        seen.push(item.id);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(2);
    expect(
      (
        await f.database.pool.query<{ status: string }>(
          "SELECT status FROM organisation_invitation WHERE id=$1",
          [first.id],
        )
      ).rows[0]?.status,
    ).toBe("pending");
    expect(
      (
        await f.query(
          "organisations.invitations.list",
          { organisationId: org.id },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
  });
  it("rotates reissued tokens and scrubs old email intents, then revokes without reviving", async () => {
    const org = await f.create();
    await f.member(org, f.bob, "admin");
    const invitation = await invite(org);
    const first = await mail(invitation.id);
    const input = { organisationId: org.id, invitationId: invitation.id };
    expect(
      (await f.mutate("organisations.invitations.resend", input, f.alice))
        .statusCode,
    ).toBe(409);
    await f.database.pool.query(
      "UPDATE organisation_invitation SET last_issued_at=now()-interval '61 seconds' WHERE id=$1",
      [invitation.id],
    );
    expect(
      (await f.mutate("organisations.invitations.resend", input, f.bob))
        .statusCode,
    ).toBe(200);
    const second = await mail(invitation.id);
    expect(second.token).not.toBe(first.token);
    expect(second.hash).not.toBe(first.hash);
    expect(
      (
        await f.database.pool.query(
          "SELECT payload,outcome FROM email_outbox WHERE id=$1",
          [first.outboxId],
        )
      ).rows[0],
    ).toEqual({ payload: null, outcome: "skipped" });
    expect(
      (await f.mutate("organisations.invitations.revoke", input, f.alice))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await f.database.pool.query(
          "SELECT payload,outcome FROM email_outbox WHERE id=$1",
          [second.outboxId],
        )
      ).rows[0],
    ).toEqual({ payload: null, outcome: "skipped" });
    expect(
      (await f.mutate("organisations.invitations.resend", input, f.alice))
        .statusCode,
    ).toBe(409);
    expect(
      (await f.mutate("organisations.invitations.revoke", input, f.alice))
        .statusCode,
    ).toBe(200);
    const adminInvite = await invite(org, { role: "admin" });
    for (const path of ["resend", "revoke"])
      expect(
        (
          await f.mutate(
            `organisations.invitations.${path}`,
            { ...input, invitationId: adminInvite.id },
            f.bob,
          )
        ).statusCode,
      ).toBe(403);
  });
});
