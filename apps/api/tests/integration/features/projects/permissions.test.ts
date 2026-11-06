import { expect, it } from "vitest";
import { useProjectFixture, type Project } from "./fixtures.js";
const { f, teams, create, query, mutate } = useProjectFixture();

it("requires authority over every selected team and preserves delegation from archived teams", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol, "admin");
  const first = await teams.create(org),
    second = await teams.create(org, { key: "WEB" });
  await teams.mutate(
    "members.add",
    {
      organisationId: org.id,
      teamId: first.id,
      userId: f.bob.id,
      role: "maintainer",
    },
    f.alice,
  );
  const payload = {
    organisationId: org.id,
    name: "Joint launch",
    teamIds: [first.id, second.id],
  };
  expect((await mutate("create", payload, f.bob)).statusCode).toBe(403);
  const project = await create(org, [first.id], f.bob);
  const input = {
    organisationId: org.id,
    projectId: project.id,
    expectedVersion: 1,
  };
  expect(
    (
      await mutate(
        "setTeams",
        { ...input, teamIds: [first.id, second.id] },
        f.bob,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await mutate(
        "setTeams",
        { ...input, teamIds: [first.id, second.id] },
        f.carol,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await teams.mutate(
        "archive",
        { organisationId: org.id, teamId: first.id, expectedVersion: 1 },
        f.carol,
      )
    ).statusCode,
  ).toBe(200);
  const edited = await mutate(
    "update",
    { ...input, expectedVersion: 2, status: "paused" },
    f.bob,
  );
  expect(edited.statusCode, edited.body).toBe(200);
  expect(f.data<Project>(edited).capabilities).toMatchObject({
    canEdit: true,
    canManageTeams: false,
  });
  expect(
    (await mutate("archive", { ...input, expectedVersion: 3 }, f.bob))
      .statusCode,
  ).toBe(403);
  await teams.mutate(
    "members.add",
    {
      organisationId: org.id,
      teamId: second.id,
      userId: f.bob.id,
      role: "maintainer",
    },
    f.alice,
  );
  expect(
    (await mutate("archive", { ...input, expectedVersion: 3 }, f.bob))
      .statusCode,
  ).toBe(200);
  // Archived project capability does not bypass fresh role checks even for an idempotent retry.
  await teams.mutate(
    "members.changeRole",
    {
      organisationId: org.id,
      teamId: second.id,
      userId: f.bob.id,
      role: "member",
    },
    f.alice,
  );
  expect(
    (await mutate("archive", { ...input, expectedVersion: 1 }, f.bob))
      .statusCode,
  ).toBe(403);
  expect(
    (await mutate("restore", { ...input, expectedVersion: 4 }, f.carol))
      .statusCode,
  ).toBe(200);
  const row = f.data<Project>(
    await query(
      "get",
      { organisationId: org.id, projectId: project.id },
      f.carol,
    ),
  );
  expect(row.version).toBe(5);
});
