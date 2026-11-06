import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import * as c from "../../src/index.js";

const organisationId = randomUUID();
const teamId = randomUUID();
const cases = [
  {
    feature: "organisation",
    create: c.createOrganisationInputSchema,
    update: c.updateOrganisationInputSchema,
    input: { name: "Example" },
    scope: { organisationId },
    fields: ["name"],
  },
  {
    feature: "team",
    create: c.createTeamInputSchema,
    update: c.updateTeamInputSchema,
    input: { organisationId, name: "Example", key: "EX", description: "Text" },
    scope: { organisationId, teamId, expectedVersion: 1 },
    fields: ["name", "description"],
  },
  {
    feature: "project",
    create: c.createProjectInputSchema,
    update: c.updateProjectInputSchema,
    input: {
      organisationId,
      name: "Example",
      description: "Text",
      teamIds: [teamId],
    },
    scope: { organisationId, projectId: randomUUID(), expectedVersion: 1 },
    fields: ["name", "description"],
  },
  {
    feature: "workflow status",
    create: c.createWorkflowStatusInputSchema,
    update: c.updateWorkflowStatusInputSchema,
    input: {
      organisationId,
      teamId,
      expectedWorkflowVersion: 1,
      name: "Example",
      description: "Text",
      category: "unstarted",
    },
    scope: {
      organisationId,
      teamId,
      statusId: randomUUID(),
      expectedWorkflowVersion: 1,
    },
    fields: ["name", "description"],
  },
  {
    feature: "issue",
    create: c.createIssueInputSchema,
    update: c.updateIssueInputSchema,
    input: { organisationId, teamId, title: "Example", description: "Text" },
    scope: { organisationId, issueId: randomUUID(), expectedVersion: 1 },
    fields: ["title", "description"],
  },
];

it.each(cases)(
  "rejects unsupported text in $feature creates and updates",
  ({ create, update, input, scope, fields }) => {
    expect(create.safeParse(input).success).toBe(true);
    for (const field of fields) {
      expect(update.safeParse({ ...scope, [field]: "Valid" }).success).toBe(
        true,
      );
      for (const value of ["\u0000", "example\u0000text"]) {
        expect(create.safeParse({ ...input, [field]: value }).success).toBe(
          false,
        );
        expect(update.safeParse({ ...scope, [field]: value }).success).toBe(
          false,
        );
      }
    }
  },
);
