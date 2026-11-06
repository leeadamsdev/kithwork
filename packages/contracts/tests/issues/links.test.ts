import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import * as contracts from "../../src/index.js";

it("supports nullable links, strict link-only edits and bounded eligible-assignee pages", () => {
  const organisationId = randomUUID(),
    teamId = randomUUID(),
    assigneeId = randomUUID(),
    projectId = randomUUID();
  expect(
    contracts.createIssueInputSchema.parse({
      organisationId,
      teamId,
      title: "Linked",
      assigneeId,
      projectId,
    }),
  ).toMatchObject({ assigneeId, projectId });
  expect(
    contracts.createIssueInputSchema.parse({
      organisationId,
      teamId,
      title: "Unlinked",
    }),
  ).toMatchObject({ assigneeId: null, projectId: null });
  expect(
    contracts.updateIssueInputSchema.parse({
      organisationId,
      issueId: randomUUID(),
      expectedVersion: 1,
      assigneeId: null,
      projectId: null,
    }),
  ).toMatchObject({ assigneeId: null, projectId: null });
  expect(
    contracts.issueAssigneePageInputSchema.parse({ organisationId, teamId }),
  ).toMatchObject({ limit: 50 });
  expect(
    contracts.issueAssigneePageInputSchema.safeParse({
      organisationId,
      teamId,
      limit: 101,
    }).success,
  ).toBe(false);
  expect(
    contracts.updateIssueInputSchema.safeParse({
      organisationId,
      issueId: randomUUID(),
      expectedVersion: 1,
      projectId: "invalid",
    }).success,
  ).toBe(false);
});

it("separates stored project identities from public available/unavailable references", () => {
  const projectId = randomUUID();
  expect(
    contracts.issueStoredChangesSchema.parse({
      project: { from: projectId, to: null },
    }),
  ).toEqual({ project: { from: projectId, to: null } });
  expect(
    contracts.issueChangesSchema.safeParse({
      project: { from: projectId, to: null },
    }).success,
  ).toBe(false);
  expect(
    contracts.issueChangesSchema.parse({
      project: { from: { available: false }, to: null },
    }),
  ).toEqual({ project: { from: { available: false }, to: null } });
  expect(
    contracts.issueChangesSchema.safeParse({
      project: {
        from: { available: false, id: projectId, name: "Hidden" },
        to: null,
      },
    }).success,
  ).toBe(false);
  expect(
    contracts.issueActivityCauseSchema.parse("organisation_member_removed"),
  ).toBe("organisation_member_removed");
});
