import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useProjectFixture, type Project } from "./fixtures.js";
import type { Page } from "../organisations/fixtures.js";
const { f, teams, create, query, mutate } = useProjectFixture();

it("filters private team associations and hidden projects before pagination and team filtering", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const shared = await teams.create(org);
  const privateTeam = await teams.create(org, {
    key: "SECRET",
    visibility: "private",
  });
  const hidden = await create(org, [privateTeam.id]);
  const visible = await create(org, [shared.id, privateTeam.id]);
  const input = { organisationId: org.id, projectId: visible.id };
  const read = await query("get", input, f.bob);
  expect(read.statusCode, read.body).toBe(200);
  expect(f.data<Project>(read).teams.map((t) => t.id)).toEqual([shared.id]);
  expect(read.body).not.toContain(privateTeam.id);
  expect(read.body).not.toContain("SECRET");
  expect(f.data<Project>(read).capabilities).toEqual({
    canEdit: false,
    canManageTeams: false,
    canArchive: false,
    canRestore: false,
  });
  const listing = f.data<Page<Project>>(
    await query("list", { organisationId: org.id, limit: 1 }, f.bob),
  );
  expect(listing.items.map((p) => p.id)).toEqual([visible.id]);
  expect(listing.nextCursor).toBeNull();
  for (const teamId of [privateTeam.id, randomUUID()])
    expect(
      (await query("list", { organisationId: org.id, teamId }, f.bob))
        .statusCode,
    ).toBe(404);
  expect(
    (
      await query(
        "get",
        { organisationId: org.id, projectId: hidden.id },
        f.bob,
      )
    ).statusCode,
  ).toBe(404);
  expect((await query("get", input, f.carol)).statusCode).toBe(404);
  expect((await query("get", input)).statusCode).toBe(401);
  expect(
    (
      await mutate(
        "create",
        { organisationId: org.id, name: "No rights", teamIds: [shared.id] },
        f.bob,
      )
    ).statusCode,
  ).toBe(403);
  await teams.mutate(
    "members.add",
    {
      organisationId: org.id,
      teamId: shared.id,
      userId: f.bob.id,
      role: "maintainer",
    },
    f.alice,
  );
  const maintained = f.data<Project>(await query("get", input, f.bob));
  expect(maintained.capabilities).toMatchObject({
    canEdit: true,
    canManageTeams: false,
    canArchive: false,
  });
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 1, description: "Shared update" },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await mutate(
        "setTeams",
        { ...input, expectedVersion: 2, teamIds: [shared.id] },
        f.bob,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await mutate("archive", { ...input, expectedVersion: 2 }, f.bob))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await mutate(
        "setTeams",
        { ...input, expectedVersion: 2, teamIds: [randomUUID()] },
        f.bob,
      )
    ).statusCode,
  ).toBe(403);
  const solo = await create(org, [shared.id], f.bob);
  expect(
    (
      await mutate(
        "archive",
        { organisationId: org.id, projectId: solo.id, expectedVersion: 1 },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
  await teams.mutate(
    "members.add",
    {
      organisationId: org.id,
      teamId: privateTeam.id,
      userId: f.bob.id,
      role: "maintainer",
    },
    f.alice,
  );
  expect(f.data<Project>(await query("get", input, f.bob)).teams).toHaveLength(
    2,
  );
  expect(
    (
      await mutate(
        "setTeams",
        { ...input, expectedVersion: 2, teamIds: [privateTeam.id] },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
  await teams.mutate(
    "members.remove",
    { organisationId: org.id, teamId: privateTeam.id, userId: f.bob.id },
    f.alice,
  );
  expect((await query("get", input, f.bob)).statusCode).toBe(404);
  expect(
    (await query("get", { organisationId: org.id, projectId: solo.id }, f.bob))
      .statusCode,
  ).toBe(200);
});

it("paginates distinct projects and scopes every relationship to its organisation", async () => {
  const org = await f.create();
  const first = await teams.create(org),
    second = await teams.create(org, { key: "WEB" });
  const other = await f.create(f.carol);
  const foreignTeam = await teams.create(other, { key: "OTHER" }, f.carol);
  expect(
    (
      await mutate(
        "create",
        { organisationId: org.id, name: "Foreign", teamIds: [foreignTeam.id] },
        f.alice,
      )
    ).statusCode,
  ).toBe(404);
  const one = await create(org, [first.id, second.id]);
  const two = await create(org, [first.id]);
  const p1 = f.data<Page<Project>>(
    await query("list", { organisationId: org.id, limit: 1 }, f.alice),
  );
  const p2 = f.data<Page<Project>>(
    await query(
      "list",
      { organisationId: org.id, limit: 1, cursor: p1.nextCursor },
      f.alice,
    ),
  );
  expect([...p1.items, ...p2.items].map((p) => p.id).sort()).toEqual(
    [one.id, two.id].sort(),
  );
  expect(p2.nextCursor).toBeNull();
  const filtered = f.data<Page<Project>>(
    await query("list", { organisationId: org.id, teamId: second.id }, f.alice),
  );
  expect(filtered.items.map((p) => p.id)).toEqual([one.id]);
  expect(
    (
      await query(
        "get",
        { organisationId: other.id, projectId: one.id },
        f.carol,
      )
    ).statusCode,
  ).toBe(404);
  const response = await mutate(
    "setTeams",
    {
      organisationId: org.id,
      projectId: one.id,
      expectedVersion: 1,
      teamIds: [foreignTeam.id],
    },
    f.alice,
  );
  expect(response.statusCode).toBe(404);
  expect(
    f.data<Project>(
      await query(
        "get",
        { organisationId: org.id, projectId: one.id },
        f.alice,
      ),
    ).version,
  ).toBe(1);
});
