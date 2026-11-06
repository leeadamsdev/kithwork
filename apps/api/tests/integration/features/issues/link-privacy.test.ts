import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type {
  IssueActivityPage,
  IssueSummary,
  Project,
} from "@kithwork/contracts";
import * as access from "../../../../src/features/teams/access.js";
import * as projectLinks from "../../../../src/features/issues/project-links.js";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, query, mutate } = useIssueFixture();

it("redacts historical project references after the project becomes private without hiding the public issue", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const publicTeam = await teams.create(org),
    privateTeam = await teams.create(org, {
      key: "SEC",
      visibility: "private",
    });
  const response = await f.mutate(
    "organisations.projects.create",
    {
      organisationId: org.id,
      name: "Secret launch",
      teamIds: [publicTeam.id, privateTeam.id],
    },
    f.alice,
  );
  expect(response.statusCode, response.body).toBe(200);
  const project = f.data<Project>(response);
  const value = await create(
    { organisationId: org.id, teamId: publicTeam.id },
    { projectId: project.id },
  );
  const scope = { organisationId: org.id, issueId: value.id };
  expect(
    (
      await mutate(
        "update",
        { ...scope, expectedVersion: 1, projectId: null },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await f.mutate(
        "organisations.projects.setTeams",
        {
          organisationId: org.id,
          projectId: project.id,
          expectedVersion: 1,
          teamIds: [privateTeam.id],
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(200);
  const hidden = await query("activity.list", scope, f.bob);
  expect(hidden.statusCode, hidden.body).toBe(200);
  expect(hidden.body).not.toContain(project.id);
  expect(hidden.body).not.toContain(project.name);
  const page = f.data<IssueActivityPage>(hidden);
  expect(page.items.map((row) => row.changes.project)).toEqual([
    { from: null, to: { available: false } },
    { from: { available: false }, to: null },
  ]);
  const owner = f.data<IssueActivityPage>(
    await query("activity.list", scope, f.alice),
  );
  expect(owner.items[0]!.changes.project!.to).toEqual({
    available: true,
    id: project.id,
    name: project.name,
  });
  const stored = await f.database.pool.query(
    "SELECT changes FROM issue_activity WHERE issue_id=$1 ORDER BY issue_version",
    [value.id],
  );
  expect(JSON.stringify(stored.rows)).toContain(project.id);
  expect(JSON.stringify(stored.rows)).not.toContain(project.name);
  expect(
    (
      await query(
        "list",
        { organisationId: org.id, projectId: project.id },
        f.bob,
      )
    ).statusCode,
  ).toBe(404);
});

it("does not expose cross-organisation or inaccessible issue links through filters and assignments", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    privateTeam = await teams.create(org, {
      key: "SEC",
      visibility: "private",
    });
  const foreign = await f.create(f.carol),
    foreignTeam = await teams.create(foreign, {}, f.carol);
  const foreignProject = f.data<Project>(
    await f.mutate(
      "organisations.projects.create",
      {
        organisationId: foreign.id,
        name: "Foreign",
        teamIds: [foreignTeam.id],
      },
      f.carol,
    ),
  );
  const project = f.data<Project>(
    await f.mutate(
      "organisations.projects.create",
      {
        organisationId: org.id,
        name: "Shared",
        teamIds: [team.id, privateTeam.id],
      },
      f.alice,
    ),
  );
  const visible = await create(
    { organisationId: org.id, teamId: team.id },
    { projectId: project.id, assigneeId: f.alice.id },
  );
  const hidden = await create(
    { organisationId: org.id, teamId: privateTeam.id },
    { projectId: project.id, assigneeId: f.alice.id, title: "Confidential" },
  );
  const pageResponse = await query(
    "list",
    { organisationId: org.id, projectId: project.id, assigneeId: f.alice.id },
    f.bob,
  );
  expect(pageResponse.statusCode, pageResponse.body).toBe(200);
  expect(
    f.data<{ items: IssueSummary[] }>(pageResponse).items.map((row) => row.id),
  ).toEqual([visible.id]);
  expect(pageResponse.body).not.toContain(hidden.id);
  for (const fields of [
    { assigneeId: f.carol.id },
    { projectId: foreignProject.id },
    { projectId: randomUUID() },
  ]) {
    expect(
      (
        await mutate(
          "create",
          {
            organisationId: org.id,
            teamId: team.id,
            title: "Invalid",
            ...fields,
          },
          f.bob,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await query("list", { organisationId: org.id, ...fields }, f.bob))
        .statusCode,
    ).toBe(404);
  }
  expect(
    (await query("get", { organisationId: org.id, issueId: hidden.id }, f.bob))
      .statusCode,
  ).toBe(404);
});

it("rechecks caller access in the directory query after its preliminary team lookup", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    scope = { organisationId: org.id, teamId: team.id };
  const original = access.readTeamAccess;
  const gate = vi
    .spyOn(access, "readTeamAccess")
    .mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await f.database.pool.query(
        "UPDATE team SET visibility='private' WHERE id=$1",
        [team.id],
      );
      return result;
    });
  try {
    const response = await query("assignees.list", scope, f.bob);
    expect(response.statusCode, response.body).toBe(200);
    expect(f.data<{ items: unknown[] }>(response).items).toEqual([]);
  } finally {
    gate.mockRestore();
  }
});

it("resolves project history using current visibility after reading the activity page", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    other = await teams.create(org, { key: "SEC", visibility: "private" });
  const project = f.data<Project>(
    await f.mutate(
      "organisations.projects.create",
      {
        organisationId: org.id,
        name: "Late private",
        teamIds: [team.id, other.id],
      },
      f.alice,
    ),
  );
  const issue = await create(
    { organisationId: org.id, teamId: team.id },
    { projectId: project.id },
  );
  await mutate(
    "update",
    {
      organisationId: org.id,
      issueId: issue.id,
      expectedVersion: 1,
      projectId: null,
    },
    f.alice,
  );
  const original = projectLinks.readVisibleIssueProjects;
  const gate = vi
    .spyOn(projectLinks, "readVisibleIssueProjects")
    .mockImplementationOnce(async (...args) => {
      await f.database.pool.query(
        "DELETE FROM project_team WHERE project_id=$1 AND team_id=$2",
        [project.id, team.id],
      );
      return original(...args);
    });
  try {
    const response = await query(
      "activity.list",
      { organisationId: org.id, issueId: issue.id },
      f.bob,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain(project.id);
    expect(response.body).not.toContain(project.name);
  } finally {
    gate.mockRestore();
  }
});
