import { expect, it } from "vitest";
import type { Team } from "@kithwork/contracts";
import { useTeamFixture } from "./fixtures.js";
const { f, create, query, mutate } = useTeamFixture();

it("filters hidden teams before pagination and distinguishes explicit membership from implicit administration", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol, "admin");
  const visible = await create(org);
  await create(org, { key: "SEC", visibility: "private" });
  const second = await create(org, { key: "WEB" });
  const otherOrg = await f.create();
  await create(otherOrg, { key: "OTHER" });
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await query(
      "list",
      { organisationId: org.id, limit: 1, ...(cursor ? { cursor } : {}) },
      f.bob,
    );
    expect(response.statusCode).toBe(200);
    const page = f.data<{ items: Team[]; nextCursor: string | null }>(response);
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(seen.sort()).toEqual([visible.id, second.id].sort());
  const admin = await query("list", { organisationId: org.id }, f.carol);
  expect(f.data<{ items: Team[] }>(admin).items).toHaveLength(3);
  const mine = await query(
    "list",
    { organisationId: org.id, scope: "mine" },
    f.carol,
  );
  expect(f.data<{ items: Team[] }>(mine).items).toEqual([]);
});

it("applies private visibility changes immediately to reads and member lists", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await create(org);
  const input = { organisationId: org.id, teamId: team.id };
  await mutate(
    "setVisibility",
    { ...input, expectedVersion: 1, visibility: "private" },
    f.alice,
  );
  for (const path of ["get", "members.list"])
    expect((await query(path, input, f.bob)).statusCode).toBe(404);
  expect(
    f.data<{ items: Team[] }>(
      await query("list", { organisationId: org.id }, f.bob),
    ).items,
  ).toEqual([]);
  await mutate("members.add", { ...input, userId: f.bob.id }, f.alice);
  expect((await query("get", input, f.bob)).statusCode).toBe(200);
  expect((await query("members.list", input, f.bob)).statusCode).toBe(200);
});
