import { describe, expect, it } from "vitest";
import { useOrganisationFixture, type Org } from "./fixtures.js";
describe("membership", () => {
  const fixture = useOrganisationFixture();
  it("enforces the administration policy and revokes only the removed membership", async () => {
    const org = await fixture.create();
    await fixture.member(org, fixture.bob, "admin");
    await fixture.member(org, fixture.carol);
    expect(
      (
        await fixture.mutate(
          "organisations.update",
          { organisationId: org.id, name: "Member rename" },
          fixture.carol,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await fixture.mutate(
          "organisations.update",
          { organisationId: org.id, name: "Admin rename" },
          fixture.bob,
        )
      ).statusCode,
    ).toBe(200);
    for (const userId of [fixture.bob.id, fixture.carol.id])
      expect(
        (
          await fixture.mutate(
            "organisations.members.changeRole",
            { organisationId: org.id, userId, role: "owner" },
            fixture.bob,
          )
        ).statusCode,
      ).toBe(403);
    for (const userId of [fixture.alice.id, fixture.bob.id])
      expect(
        (
          await fixture.mutate(
            "organisations.members.remove",
            { organisationId: org.id, userId },
            fixture.bob,
          )
        ).statusCode,
      ).toBe(403);
    const other = await fixture.create(fixture.carol);
    expect(
      (
        await fixture.mutate(
          "organisations.members.remove",
          { organisationId: org.id, userId: fixture.carol.id },
          fixture.bob,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.query(
          "organisations.get",
          { organisationId: org.id },
          fixture.carol,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.query(
          "organisations.get",
          { organisationId: other.id },
          fixture.carol,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.app.inject({
          url: "/trpc/auth.me",
          headers: { cookie: fixture.carol.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("scopes membership targets and rejects actor or role injection", async () => {
    const a = await fixture.create();
    const b = await fixture.create(fixture.bob);
    await fixture.member(b, fixture.carol);
    for (const path of [
      "organisations.members.changeRole",
      "organisations.members.remove",
    ]) {
      const input = {
        organisationId: a.id,
        userId: fixture.carol.id,
        ...(path.endsWith("changeRole") ? { role: "owner" } : {}),
      };
      expect(
        (await fixture.mutate(path, input, fixture.alice)).statusCode,
      ).toBe(404);
    }
    expect(
      (
        await fixture.mutate(
          "organisations.create",
          { name: "Spoofed", role: "owner", userId: fixture.bob.id },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await fixture.mutate(
          "organisations.update",
          { organisationId: a.id, name: "Spoofed", actorId: fixture.bob.id },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      fixture.data<Org>(
        await fixture.query(
          "organisations.get",
          { organisationId: b.id },
          fixture.carol,
        ),
      ).role,
    ).toBe("member");
  });
  it("preserves an owner under leave, removal and role-change attempts", async () => {
    const org = await fixture.create();
    expect(
      (
        await fixture.mutate(
          "organisations.leave",
          { organisationId: org.id },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await fixture.mutate(
          "organisations.members.remove",
          { organisationId: org.id, userId: fixture.alice.id },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await fixture.mutate(
          "organisations.members.changeRole",
          { organisationId: org.id, userId: fixture.alice.id, role: "admin" },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(409);
    await fixture.member(org, fixture.bob);
    expect(
      (
        await fixture.mutate(
          "organisations.members.changeRole",
          { organisationId: org.id, userId: fixture.bob.id, role: "owner" },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.mutate(
          "organisations.leave",
          { organisationId: org.id },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await fixture.query(
          "organisations.get",
          { organisationId: org.id },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      fixture.data<Org>(
        await fixture.query(
          "organisations.get",
          { organisationId: org.id },
          fixture.bob,
        ),
      ).role,
    ).toBe("owner");
  });
});
