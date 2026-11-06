import { expect, it } from "vitest";
import type { IssueDetail, Project } from "@kithwork/contracts";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, get, mutate } = useIssueFixture();

it("retains existing archived project links but rejects new archived or non-participating associations", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org),
    otherTeam = await teams.create(org, { key: "WEB" });
  const scope = { organisationId: org.id, teamId: team.id };
  async function project(name: string, teamIds = [team.id]) {
    const response = await f.mutate(
      "organisations.projects.create",
      { organisationId: org.id, name, teamIds },
      f.alice,
    );
    expect(response.statusCode, response.body).toBe(200);
    return f.data<Project>(response);
  }
  const first = await project("First"),
    second = await project("Second"),
    other = await project("Other", [otherTeam.id]);
  const issue = await create(scope, { projectId: first.id });
  const input = {
    organisationId: org.id,
    issueId: issue.id,
    expectedVersion: 1,
  };
  for (const value of [first, second])
    expect(
      (
        await f.mutate(
          "organisations.projects.archive",
          { organisationId: org.id, projectId: value.id, expectedVersion: 1 },
          f.alice,
        )
      ).statusCode,
    ).toBe(200);
  const retained = (await get(input)).project;
  expect(retained?.id).toBe(first.id);
  expect(retained?.archivedAt).toBeTypeOf("string");
  const keep = await mutate(
    "update",
    { ...input, projectId: first.id.toUpperCase(), title: "Still editable" },
    f.bob,
  );
  expect(keep.statusCode, keep.body).toBe(200);
  expect(f.data<IssueDetail>(keep).version).toBe(2);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 2, projectId: second.id },
        f.bob,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "create",
        { ...scope, title: "Archived", projectId: first.id },
        f.bob,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 2, projectId: other.id },
        f.bob,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 2, projectId: null },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
});

it("rejects detaching any team with linked active or archived issues without revealing issue details", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    other = await teams.create(org, { key: "WEB" });
  const scope = { organisationId: org.id, teamId: team.id };
  const project = f.data<Project>(
    await f.mutate(
      "organisations.projects.create",
      { organisationId: org.id, name: "Shared", teamIds: [team.id, other.id] },
      f.alice,
    ),
  );
  const issue = await create(scope, { projectId: project.id });
  const input = {
    organisationId: org.id,
    projectId: project.id,
    expectedVersion: 1,
    teamIds: [other.id],
  };
  for (const archived of [false, true]) {
    if (archived)
      expect(
        (
          await mutate(
            "archive",
            { organisationId: org.id, issueId: issue.id, expectedVersion: 1 },
            f.alice,
          )
        ).statusCode,
      ).toBe(200);
    const response = await f.mutate(
      "organisations.projects.setTeams",
      input,
      f.alice,
    );
    expect(response.statusCode, response.body).toBe(409);
    expect(response.body).not.toContain(issue.id);
    expect(response.body).not.toContain(issue.title);
  }
  await mutate(
    "restore",
    { organisationId: org.id, issueId: issue.id, expectedVersion: 2 },
    f.alice,
  );
  await mutate(
    "update",
    {
      organisationId: org.id,
      issueId: issue.id,
      expectedVersion: 3,
      projectId: null,
    },
    f.alice,
  );
  expect(
    (await f.mutate("organisations.projects.setTeams", input, f.alice))
      .statusCode,
  ).toBe(200);
});
