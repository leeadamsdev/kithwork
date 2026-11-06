import { expect, it } from "vitest";
import type { Team } from "@kithwork/contracts";
import { useTeamFixture } from "./fixtures.js";

const { f, create, query, mutate } = useTeamFixture();

it("creates a team and its initial maintainer atomically, with scoped key uniqueness", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  expect(
    (
      await mutate(
        "create",
        { organisationId: org.id, name: "Backend", key: "ENG" },
        f.bob,
      )
    ).statusCode,
  ).toBe(403);
  const team = await create(org);
  expect(team).toMatchObject({
    key: "ENG",
    version: 1,
    visibility: "organisation",
    membershipRole: "maintainer",
    description: null,
    archivedAt: null,
  });
  expect(
    (
      await mutate(
        "create",
        { organisationId: org.id, name: "Duplicate", key: " eng " },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (await query("get", { organisationId: org.id, teamId: team.id }, f.bob))
      .statusCode,
  ).toBe(200);
  expect(
    (await query("get", { organisationId: org.id, teamId: team.id }, f.carol))
      .statusCode,
  ).toBe(404);
  expect(
    (await query("get", { organisationId: org.id, teamId: team.id }))
      .statusCode,
  ).toBe(401);
});

it("checks versions, separates privacy administration and preserves no-op versions", async () => {
  const org = await f.create();
  const team = await create(org);
  const input = { organisationId: org.id, teamId: team.id, expectedVersion: 1 };
  const changed = await mutate(
    "update",
    { ...input, name: "Platform", description: " Delivery " },
    f.alice,
  );
  expect(changed.statusCode, changed.body).toBe(200);
  expect(f.data<Team>(changed)).toMatchObject({
    name: "Platform",
    description: "Delivery",
    version: 2,
  });
  expect(
    (await mutate("update", { ...input, name: "Stale" }, f.alice)).statusCode,
  ).toBe(409);
  const unchanged = await mutate(
    "update",
    { ...input, expectedVersion: 2, name: "Platform" },
    f.alice,
  );
  expect(f.data<Team>(unchanged).version).toBe(2);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 2, visibility: "private" },
        f.alice,
      )
    ).statusCode,
  ).toBe(400);
  const privateResponse = await mutate(
    "setVisibility",
    { ...input, expectedVersion: 2, visibility: "private" },
    f.alice,
  );
  expect(privateResponse.statusCode, privateResponse.body).toBe(200);
  expect(f.data<Team>(privateResponse)).toMatchObject({
    version: 3,
    visibility: "private",
  });
});

it("archives and restores explicitly while retaining read access and reserved keys", async () => {
  const org = await f.create();
  const team = await create(org);
  const input = { organisationId: org.id, teamId: team.id, expectedVersion: 1 };
  const archived = await mutate("archive", input, f.alice);
  expect(archived.statusCode, archived.body).toBe(200);
  expect(f.data<Team>(archived).archivedAt).not.toBeNull();
  expect((await mutate("archive", input, f.alice)).statusCode).toBe(200);
  expect((await query("get", input, f.alice)).statusCode).toBe(400);
  expect(
    (await query("get", { organisationId: org.id, teamId: team.id }, f.alice))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 2, name: "Frozen" },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  const page = await query("list", { organisationId: org.id }, f.alice);
  expect(f.data<{ items: Team[] }>(page).items).toEqual([]);
  expect(
    (
      await mutate(
        "create",
        { organisationId: org.id, name: "Other", key: "ENG" },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  const restored = await mutate(
    "restore",
    { ...input, expectedVersion: 2 },
    f.alice,
  );
  expect(f.data<Team>(restored)).toMatchObject({
    archivedAt: null,
    version: 3,
  });
});
