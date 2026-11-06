import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useInvitationFixture } from "./fixtures.js";

describe("invitation issuance", () => {
  const { fixture: f, invite, mail } = useInvitationFixture();
  it("requires membership and grant authority without exposing other tenants", async () => {
    const org = await f.create();
    await f.member(org, f.bob, "admin");
    await f.member(org, f.carol);
    const input = {
      organisationId: org.id,
      email: "new-member@example.test",
      role: "member",
    };
    for (const [actor, status] of [
      [undefined, 401],
      [f.carol, 403],
    ] as const)
      expect(
        (await f.mutate("organisations.invitations.create", input, actor))
          .statusCode,
      ).toBe(status);
    expect(
      (
        await f.mutate(
          "organisations.invitations.create",
          { ...input, organisationId: randomUUID() },
          f.alice,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.mutate(
          "organisations.invitations.create",
          { ...input, role: "admin" },
          f.bob,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.mutate(
          "organisations.invitations.create",
          { ...input, role: "owner" },
          f.alice,
        )
      ).statusCode,
    ).toBe(400);
    await invite(org, { actor: f.bob });
    await invite(org, { role: "admin" });
    expect(
      (
        await f.query(
          "organisations.invitations.list",
          { organisationId: org.id },
          f.carol,
        )
      ).statusCode,
    ).toBe(403);
  });
  it("atomically stores a normalised invitation and a bound encrypted email intent", async () => {
    const org = await f.create(f.alice, "Engineering <script>");
    const email = `${randomUUID()}@example.test`;
    const invitation = await invite(org, {
      email: `  ${email.toUpperCase()}  `,
    });
    expect(invitation).toMatchObject({
      organisationId: org.id,
      email,
      issuerId: f.alice.id,
      status: "pending",
      emailStatus: "pending",
    });
    expect(
      Date.parse(invitation.resendAvailableAt) -
        Date.parse(invitation.createdAt),
    ).toBe(60_000);
    expect(
      Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt),
    ).toBe(7 * 86_400_000);
    const stored = await mail(invitation.id);
    expect(stored.message).toMatchObject({
      kind: "invitation",
      to: email,
      organisationName: org.name,
    });
    expect(stored.url.origin).toBe(f.webOrigin);
    expect(stored.url.pathname).toBe(`/invitations/${invitation.id}`);
    expect(stored.url.search).toBe("");
    expect(stored.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.hash).toBe(
      createHash("sha256").update(stored.token).digest("hex"),
    );
    expect(JSON.stringify(invitation)).not.toMatch(/token|payload|hash/i);
    expect(f.logLines.join("")).not.toContain(stored.token);
  });
  it("serialises duplicate creation and rejects existing members", async () => {
    const org = await f.create();
    await f.member(org, f.bob);
    expect(
      (
        await f.mutate(
          "organisations.invitations.create",
          {
            organisationId: org.id,
            email: f.bob.email,
            role: "member",
          },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
    const email = `${randomUUID()}@example.test`;
    const results = await Promise.all(
      [0, 1].map(() =>
        f.mutate(
          "organisations.invitations.create",
          { organisationId: org.id, email, role: "member" },
          f.alice,
        ),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (
        await f.database.pool.query(
          "SELECT id FROM organisation_invitation WHERE organisation_id=$1 AND email=$2",
          [org.id, email],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await f.database.pool.query(
          "SELECT o.id FROM email_outbox o JOIN organisation_invitation i ON i.id=o.invitation_id WHERE i.organisation_id=$1",
          [org.id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
