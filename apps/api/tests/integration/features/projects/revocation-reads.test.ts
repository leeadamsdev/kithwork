import { expect, it, vi } from "vitest";
import * as teamAccess from "../../../../src/features/teams/access.js";
import * as projectQueries from "../../../../src/features/projects/queries.js";
import { useProjectFixture } from "./fixtures.js";
const { f, teams, create, query } = useProjectFixture();

it("does not reveal a private association through a team filter after access is revoked", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const shared = await teams.create(org),
    hidden = await teams.create(org, { key: "SECRET", visibility: "private" });
  await teams.mutate(
    "members.add",
    { organisationId: org.id, teamId: hidden.id, userId: f.bob.id },
    f.alice,
  );
  await create(org, [shared.id, hidden.id]);
  const release = Promise.withResolvers<void>();
  let waiting = false;
  const original = teamAccess.readTeamAccess;
  const gate = vi
    .spyOn(teamAccess, "readTeamAccess")
    .mockImplementationOnce(async (...args) => {
      const access = await original(...args);
      waiting = true;
      await release.promise;
      return access;
    });
  const pending = query(
    "list",
    { organisationId: org.id, teamId: hidden.id },
    f.bob,
  );
  try {
    await expect.poll(() => waiting).toBe(true);
    expect(
      (
        await teams.mutate(
          "members.remove",
          { organisationId: org.id, teamId: hidden.id, userId: f.bob.id },
          f.alice,
        )
      ).statusCode,
    ).toBe(200);
    release.resolve();
    const response = await pending;
    expect(response.statusCode, response.body).toBe(200);
    expect(f.data(response)).toEqual({ items: [], nextCursor: null });
  } finally {
    release.resolve();
    await pending;
    gate.mockRestore();
  }
});

it("does not return project details after organisation membership is revoked after middleware authorisation", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const project = await create(org, [team.id]);
  const release = Promise.withResolvers<void>();
  let waiting = false;
  const original = projectQueries.getProject;
  const gate = vi
    .spyOn(projectQueries, "getProject")
    .mockImplementationOnce(async (...args) => {
      waiting = true;
      await release.promise;
      return original(...args);
    });
  const pending = query(
    "get",
    { organisationId: org.id, projectId: project.id },
    f.bob,
  );
  try {
    await expect.poll(() => waiting).toBe(true);
    expect(
      (
        await f.mutate(
          "organisations.members.remove",
          { organisationId: org.id, userId: f.bob.id },
          f.alice,
        )
      ).statusCode,
    ).toBe(200);
    release.resolve();
    expect((await pending).statusCode).toBe(404);
  } finally {
    release.resolve();
    await pending;
    gate.mockRestore();
  }
});
