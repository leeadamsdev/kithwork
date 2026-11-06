import { expect, it } from "vitest";
import { useProjectFixture, type Project } from "./fixtures.js";
const { f, teams, create, mutate, query } = useProjectFixture();

it("protects the last active team across project lifecycle and concurrent team archives", async () => {
  const org = await f.create();
  const first = await teams.create(org),
    second = await teams.create(org, { key: "WEB" });
  const row = await create(org, [first.id, second.id]);
  const input = {
    organisationId: org.id,
    projectId: row.id,
    expectedVersion: 1,
  };
  const archives = await Promise.all(
    [first, second].map((team) =>
      teams.mutate(
        "archive",
        { organisationId: org.id, teamId: team.id, expectedVersion: 1 },
        f.alice,
      ),
    ),
  );
  expect(archives.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const archivedIndex = archives.findIndex((r) => r.statusCode === 200);
  const inactive = [first, second][archivedIndex]!,
    active = [first, second][1 - archivedIndex]!;
  expect(
    (await mutate("setTeams", { ...input, teamIds: [inactive.id] }, f.alice))
      .statusCode,
  ).toBe(409);
  const retained = await teams.create(org, { key: "RETAIN" });
  expect(
    (
      await mutate(
        "setTeams",
        { ...input, teamIds: [inactive.id, active.id, retained.id] },
        f.alice,
      )
    ).statusCode,
  ).toBe(200);
  const fresh = { ...input, expectedVersion: 2 };
  const alreadyArchived = await teams.create(org, { key: "OLD" });
  await teams.mutate(
    "archive",
    { organisationId: org.id, teamId: alreadyArchived.id, expectedVersion: 1 },
    f.alice,
  );
  expect(
    (
      await mutate(
        "create",
        {
          organisationId: org.id,
          name: "Old",
          teamIds: [active.id, alreadyArchived.id],
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "setTeams",
        { ...fresh, teamIds: [active.id, alreadyArchived.id] },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect((await mutate("archive", fresh, f.alice)).statusCode).toBe(200);
  await teams.mutate(
    "archive",
    { organisationId: org.id, teamId: active.id, expectedVersion: 1 },
    f.alice,
  );
  await teams.mutate(
    "archive",
    { organisationId: org.id, teamId: retained.id, expectedVersion: 1 },
    f.alice,
  );
  expect(
    (await mutate("restore", { ...input, expectedVersion: 3 }, f.alice))
      .statusCode,
  ).toBe(409);
  expect(
    f.data<Project>(
      await query(
        "get",
        { organisationId: org.id, projectId: row.id },
        f.alice,
      ),
    ).teams,
  ).toHaveLength(3);
  await teams.mutate(
    "restore",
    { organisationId: org.id, teamId: active.id, expectedVersion: 2 },
    f.alice,
  );
  expect(
    (await mutate("restore", { ...input, expectedVersion: 3 }, f.alice))
      .statusCode,
  ).toBe(200);
});
