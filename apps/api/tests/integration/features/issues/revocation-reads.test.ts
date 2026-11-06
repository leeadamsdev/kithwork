import { expect, it, vi } from "vitest";
import * as access from "../../../../src/features/issues/access.js";
import * as queries from "../../../../src/features/issues/queries.js";
import * as teamAccess from "../../../../src/features/teams/access.js";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, query } = useIssueFixture();

it("rechecks organisation access in issue detail and identifier data queries", async () => {
  for (const mode of ["get", "getByIdentifier"] as const) {
    const org = await f.create();
    await f.member(org, f.bob);
    const team = await teams.create(org);
    const issue = await create({ organisationId: org.id, teamId: team.id });
    const release = Promise.withResolvers<void>();
    let waiting = false;
    const originalGet = access.readIssueAccess,
      originalIdentifier = queries.getIssueByIdentifier;
    const gate =
      mode === "get"
        ? vi
            .spyOn(access, "readIssueAccess")
            .mockImplementationOnce(async (...args) => {
              waiting = true;
              await release.promise;
              return originalGet(...args);
            })
        : vi
            .spyOn(queries, "getIssueByIdentifier")
            .mockImplementationOnce(async (...args) => {
              waiting = true;
              await release.promise;
              return originalIdentifier(...args);
            });
    const pending = query(
      mode,
      {
        organisationId: org.id,
        ...(mode === "get"
          ? { issueId: issue.id }
          : { identifier: issue.identifier }),
      },
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
  }
});

it("does not leak filtered issues or history when private access disappears after a precheck", async () => {
  for (const mode of ["list", "activity.list"] as const) {
    const org = await f.create();
    await f.member(org, f.bob);
    const team = await teams.create(org, { visibility: "private" });
    const scope = { organisationId: org.id, teamId: team.id };
    await teams.mutate("members.add", { ...scope, userId: f.bob.id }, f.alice);
    const issue = await create(scope);
    const release = Promise.withResolvers<void>();
    let waiting = false;
    const originalTeam = teamAccess.readTeamAccess,
      originalIssue = access.readIssueAccess;
    const gate =
      mode === "list"
        ? vi
            .spyOn(teamAccess, "readTeamAccess")
            .mockImplementationOnce(async (...args) => {
              const result = await originalTeam(...args);
              waiting = true;
              await release.promise;
              return result;
            })
        : vi
            .spyOn(access, "readIssueAccess")
            .mockImplementationOnce(async (...args) => {
              const result = await originalIssue(...args);
              waiting = true;
              await release.promise;
              return result;
            });
    const pending = query(
      mode,
      mode === "list" ? scope : { organisationId: org.id, issueId: issue.id },
      f.bob,
    );
    try {
      await expect.poll(() => waiting).toBe(true);
      expect(
        (
          await teams.mutate(
            "members.remove",
            { ...scope, userId: f.bob.id },
            f.alice,
          )
        ).statusCode,
      ).toBe(200);
      release.resolve();
      const response = await pending;
      expect(response.statusCode, response.body).toBe(200);
      expect(f.data(response)).toEqual({ items: [], nextCursor: null });
      expect(response.body).not.toContain(issue.id);
    } finally {
      release.resolve();
      await pending;
      gate.mockRestore();
    }
  }
});
