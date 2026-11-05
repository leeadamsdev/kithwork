import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  useOrganisationFixture,
  type Org,
  type Member,
  type Page,
} from "./fixtures.js";
describe("queries", () => {
  const fixture = useOrganisationFixture();
  it("requires verified identity and atomically creates the first owner", async () => {
    expect(
      (await fixture.mutate("organisations.create", { name: "Team" }))
        .statusCode,
    ).toBe(401);
    expect(
      fixture.data<Page<Org>>(
        await fixture.query("organisations.list", {}, fixture.alice),
      ).items,
    ).toEqual([]);
    const org = await fixture.create(fixture.alice, "  Engineering 工程  ");
    expect(org).toMatchObject({ name: "Engineering 工程", role: "owner" });
    expect(
      (
        await fixture.database.pool.query(
          "SELECT user_id,role FROM organisation_member WHERE organisation_id=$1",
          [org.id],
        )
      ).rows,
    ).toEqual([{ user_id: fixture.alice.id, role: "owner" }]);
    expect(
      (
        await fixture.query(
          "organisations.get",
          { organisationId: org.id },
          fixture.alice,
        )
      ).headers["cache-control"],
    ).toBe("no-store");
  });
  it("isolates tenants and reads current membership for each organisation", async () => {
    const a = await fixture.create(fixture.alice);
    const b = await fixture.create(fixture.bob);
    await fixture.member(b, fixture.alice, "admin");
    expect(
      fixture.data<Org>(
        await fixture.query(
          "organisations.get",
          { organisationId: a.id },
          fixture.alice,
        ),
      ).role,
    ).toBe("owner");
    expect(
      fixture.data<Org>(
        await fixture.query(
          "organisations.get",
          { organisationId: b.id },
          fixture.alice,
        ),
      ).role,
    ).toBe("admin");
    for (const id of [a.id, randomUUID()])
      expect(
        (
          await fixture.query(
            "organisations.get",
            { organisationId: id },
            fixture.carol,
          )
        ).statusCode,
      ).toBe(404);
    expect(
      (
        await fixture.query(
          "organisations.members.list",
          { organisationId: a.id },
          fixture.bob,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.mutate(
          "organisations.update",
          { organisationId: a.id, name: "Stolen" },
          fixture.bob,
        )
      ).statusCode,
    ).toBe(404);
  });
  it("keeps independently authorised organisation contexts in a mixed batch", async () => {
    const a = await fixture.create();
    const b = await fixture.create(fixture.bob);
    const c = await fixture.create(fixture.carol);
    await fixture.member(b, fixture.alice, "admin");
    const response = await fixture.app.inject({
      url: `/trpc/organisations.get,organisations.get,organisations.get?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { organisationId: a.id }, 1: { organisationId: b.id }, 2: { organisationId: c.id } }))}`,
      headers: { cookie: fixture.alice.cookie },
    });
    expect(response.statusCode).toBe(207);
    const result =
      response.json<
        [
          { result: { data: Org } },
          { result: { data: Org } },
          { error: { data: { httpStatus: number } } },
        ]
      >();
    expect(result[0].result.data).toMatchObject({ id: a.id, role: "owner" });
    expect(result[1].result.data).toMatchObject({ id: b.id, role: "admin" });
    expect(result[2].error.data.httpStatus).toBe(404);
  });
  it("paginates a safe member directory and only lists the caller's organisations", async () => {
    const org = await fixture.create();
    await fixture.member(org, fixture.bob);
    await fixture.member(org, fixture.carol);
    const seen: Member[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const response = await fixture.query(
        "organisations.members.list",
        { organisationId: org.id, limit: 1, ...(cursor ? { cursor } : {}) },
        fixture.alice,
      );
      expect(response.statusCode).toBe(200);
      const value = fixture.data<Page<Member>>(response);
      expect(value.items).toHaveLength(1);
      seen.push(...value.items);
      expect(response.body).not.toMatch(/email|password|token/);
      expect(Object.keys(value.items[0]!).sort()).toEqual([
        "joinedAt",
        "name",
        "role",
        "userId",
      ]);
      cursor = value.nextCursor ?? undefined;
    }
    expect(cursor).toBeUndefined();
    expect(new Set(seen.map((item) => item.userId)).size).toBe(3);
    const listed = new Set<string>();
    let orgCursor: string | undefined;
    do {
      const response = fixture.data<Page<Org>>(
        await fixture.query(
          "organisations.list",
          { limit: 2, ...(orgCursor ? { cursor: orgCursor } : {}) },
          fixture.alice,
        ),
      );
      expect(response.items.length).toBeLessThanOrEqual(2);
      for (const value of response.items) {
        expect(listed.has(value.id)).toBe(false);
        listed.add(value.id);
      }
      orgCursor = response.nextCursor ?? undefined;
    } while (orgCursor);
    const actual = await fixture.database.pool.query<{
      organisation_id: string;
    }>("SELECT organisation_id FROM organisation_member WHERE user_id=$1", [
      fixture.alice.id,
    ]);
    expect([...listed].sort()).toEqual(
      actual.rows.map((row) => row.organisation_id).sort(),
    );
    expect(
      (
        await fixture.query(
          "organisations.members.list",
          { organisationId: org.id, limit: 101 },
          fixture.alice,
        )
      ).statusCode,
    ).toBe(400);
  });
});
