import { expect, it } from "vitest";
import { useIssueFixture } from "../../features/issues/fixtures.js";

const issues = useIssueFixture();
const { f, teams } = issues;

it("rejects unsupported persisted text across feature creates and updates without changing data", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const teamScope = { organisationId: org.id, teamId: team.id };
  const issue = await issues.create(teamScope);
  const projectResponse = await f.mutate(
    "organisations.projects.create",
    {
      organisationId: org.id,
      name: "Project",
      teamIds: [team.id],
    },
    f.alice,
  );
  expect(projectResponse.statusCode, projectResponse.body).toBe(200);
  const project = f.data<{ id: string }>(projectResponse);
  const cases = [
    {
      path: "organisations",
      create: { name: "Organisation" },
      update: { organisationId: org.id },
      fields: ["name"],
    },
    {
      path: "organisations.teams",
      create: { organisationId: org.id, key: "NEW", name: "Team" },
      update: { ...teamScope, expectedVersion: 1 },
      fields: ["name", "description"],
    },
    {
      path: "organisations.projects",
      create: { organisationId: org.id, name: "Project", teamIds: [team.id] },
      update: {
        organisationId: org.id,
        projectId: project.id,
        expectedVersion: 1,
      },
      fields: ["name", "description"],
    },
    {
      path: "organisations.teams.workflow.statuses",
      create: {
        ...teamScope,
        expectedWorkflowVersion: 1,
        name: "Status",
        category: "unstarted",
      },
      update: {
        ...teamScope,
        statusId: issue.statusId,
        expectedWorkflowVersion: 1,
      },
      fields: ["name", "description"],
    },
    {
      path: "organisations.issues",
      create: { ...teamScope, title: "Issue" },
      update: { organisationId: org.id, issueId: issue.id, expectedVersion: 1 },
      fields: ["title", "description"],
    },
  ];
  const snapshot = () =>
    f.database.pool.query(
      "SELECT (SELECT jsonb_agg(o) FROM organisation o) AS organisations, (SELECT jsonb_agg(t) FROM team t) AS teams, (SELECT jsonb_agg(p) FROM project p) AS projects, (SELECT jsonb_agg(s) FROM workflow_status s) AS statuses, (SELECT jsonb_agg(i) FROM issue i) AS issues",
    );
  const before = (await snapshot()).rows;
  for (const entry of cases) {
    for (const field of entry.fields) {
      for (const body of ["\u0000", "example\u0000text"]) {
        for (const [operation, input] of [
          ["create", entry.create],
          ["update", entry.update],
        ] as const) {
          const response = await f.mutate(
            `${entry.path}.${operation}`,
            { ...input, [field]: body },
            f.alice,
          );
          expect(
            response.statusCode,
            `${entry.path}.${operation}.${field}: ${response.body}`,
          ).toBe(400);
        }
      }
    }
  }
  expect((await snapshot()).rows).toEqual(before);
});
