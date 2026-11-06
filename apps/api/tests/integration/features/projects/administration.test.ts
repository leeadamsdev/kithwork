import { expect, it } from "vitest";
import type { Project } from "./fixtures.js";
import { useProjectFixture } from "./fixtures.js";
const { f, teams, create, query, mutate } = useProjectFixture();

it("creates a multi-team project and enforces versioned metadata, merged dates and lifecycle", async () => {
  const org = await f.create();
  const first = await teams.create(org);
  const second = await teams.create(org, { key: "WEB" });
  const row = await create(org, [first.id, second.id], f.alice, {
    startDate: "2026-12-01",
    targetDate: "2026-12-31",
  });
  expect(row).toMatchObject({
    version: 1,
    status: "planned",
    startDate: "2026-12-01",
    targetDate: "2026-12-31",
  });
  expect(row.teams.map((t) => t.id).sort()).toEqual(
    [first.id, second.id].sort(),
  );
  const input = {
    organisationId: org.id,
    projectId: row.id,
    expectedVersion: 1,
  };
  expect(
    (await mutate("update", { ...input, targetDate: "2026-11-30" }, f.alice))
      .statusCode,
  ).toBe(400);
  expect(
    (await mutate("update", { ...input, startDate: "2027-01-01" }, f.alice))
      .statusCode,
  ).toBe(400);
  const edited = f.data<Project>(
    await mutate(
      "update",
      { ...input, status: "active", description: "Shared plan" },
      f.alice,
    ),
  );
  expect(edited).toMatchObject({
    version: 2,
    status: "active",
    description: "Shared plan",
  });
  expect(
    (await mutate("update", { ...input, name: "Stale" }, f.alice)).statusCode,
  ).toBe(409);
  const current = { ...input, expectedVersion: 2 };
  expect(
    f.data<Project>(
      await mutate("update", { ...current, status: "active" }, f.alice),
    ).version,
  ).toBe(2);
  expect(
    f.data<Project>(
      await mutate(
        "setTeams",
        { ...current, teamIds: [second.id, first.id] },
        f.alice,
      ),
    ).version,
  ).toBe(2);
  const archived = f.data<Project>(await mutate("archive", current, f.alice));
  expect(archived).toMatchObject({
    version: 3,
    capabilities: { canEdit: false, canManageTeams: false, canRestore: true },
  });
  expect(f.data<Project>(await mutate("archive", input, f.alice)).version).toBe(
    3,
  );
  expect(
    (
      await mutate(
        "update",
        { ...current, expectedVersion: 3, name: "Frozen" },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "setTeams",
        { ...current, expectedVersion: 3, teamIds: [first.id] },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    f.data<{ items: Project[] }>(
      await query("list", { organisationId: org.id }, f.alice),
    ).items,
  ).toHaveLength(0);
  expect(
    f.data<{ items: Project[] }>(
      await query(
        "list",
        { organisationId: org.id, archived: "only", status: "active" },
        f.alice,
      ),
    ).items,
  ).toHaveLength(1);
  const restored = f.data<Project>(
    await mutate("restore", { ...input, expectedVersion: 3 }, f.alice),
  );
  expect(restored).toMatchObject({ version: 4, archivedAt: null });
  const cleared = f.data<Project>(
    await mutate(
      "update",
      {
        ...input,
        expectedVersion: 4,
        startDate: null,
        targetDate: null,
        description: null,
      },
      f.alice,
    ),
  );
  expect(cleared).toMatchObject({
    version: 5,
    startDate: null,
    targetDate: null,
    description: null,
  });
});
