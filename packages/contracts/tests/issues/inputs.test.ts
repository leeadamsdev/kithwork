import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import * as contracts from "../../src/index.js";

const scope = { organisationId: randomUUID(), teamId: randomUUID() };

it("validates issue fields while preserving Markdown and shared calendar-date semantics", () => {
  expect(
    contracts.createIssueInputSchema.parse({
      ...scope,
      title: "  Fix race  ",
      description: "  code\n\n    preserved  ",
    }),
  ).toMatchObject({
    title: "Fix race",
    description: "  code\n\n    preserved  ",
    priority: "none",
    dueDate: null,
  });
  expect(
    contracts.createIssueInputSchema.parse({
      ...scope,
      title: "Fix",
      description: " \n ",
    }).description,
  ).toBeNull();
  expect(contracts.projectDateSchema).toBe(contracts.calendarDateSchema);
  expect(contracts.calendarDateSchema.parse("2024-02-29")).toBe("2024-02-29");
  for (const patch of [
    { title: " " },
    { title: "x".repeat(201) },
    { description: "x".repeat(20001) },
    { dueDate: "2025-02-29" },
    { dueDate: "0000-01-01" },
    { dueDate: "2026-11-06T00:00:00Z" },
    { priority: "medium" },
    { number: 1 },
    { assigneeId: randomUUID() },
  ])
    expect(
      contracts.createIssueInputSchema.safeParse({
        ...scope,
        title: "Issue",
        ...patch,
      }).success,
    ).toBe(false);
  const update = {
    organisationId: scope.organisationId,
    issueId: randomUUID(),
    expectedVersion: 1,
  };
  expect(contracts.updateIssueInputSchema.safeParse(update).success).toBe(
    false,
  );
  expect(
    contracts.updateIssueInputSchema.safeParse({
      ...update,
      teamId: scope.teamId,
    }).success,
  ).toBe(false);
  expect(
    contracts.updateIssueInputSchema.parse({
      ...update,
      description: null,
      dueDate: null,
    }),
  ).toMatchObject({ description: null, dueDate: null });
});

it("normalises human identifiers and rejects unsafe or ambiguous numbers", () => {
  const organisationId = scope.organisationId;
  expect(
    contracts.issueIdentifierInputSchema.parse({
      organisationId,
      identifier: " eng-123 ",
    }).identifier,
  ).toBe("ENG-123");
  for (const identifier of [
    "ENG-0",
    "ENG-01",
    "ENG-2147483648",
    "E-1",
    "ENG--1",
    "ENG-1 OR 1=1",
    "ENG-1.5",
  ])
    expect(
      contracts.issueIdentifierInputSchema.safeParse({
        organisationId,
        identifier,
      }).success,
    ).toBe(false);
});

it("round trips opaque millisecond issue cursors and bounds issue/history pages", () => {
  const cursor = { createdAt: "2026-11-06T12:34:56.789Z", id: randomUUID() };
  const encoded = contracts.encodeIssueCursor(cursor);
  expect(
    contracts.issueListInputSchema.parse({
      organisationId: scope.organisationId,
      cursor: encoded,
    }),
  ).toMatchObject({
    cursor,
    limit: 50,
    archived: "exclude",
    includeArchivedTeams: false,
  });
  for (const token of [
    "garbage!",
    btoa("{}"),
    btoa(JSON.stringify({ ...cursor, createdAt: "2026-11-06T12:34:56Z" })),
    btoa(JSON.stringify({ ...cursor, extra: true })),
  ])
    expect(
      contracts.issueListInputSchema.safeParse({
        organisationId: scope.organisationId,
        cursor: token,
      }).success,
    ).toBe(false);
  expect(
    contracts.issueListInputSchema.safeParse({
      organisationId: scope.organisationId,
      limit: 101,
    }).success,
  ).toBe(false);
  expect(
    contracts.issueActivityPageInputSchema.safeParse({
      organisationId: scope.organisationId,
      issueId: randomUUID(),
      cursor: 0,
    }).success,
  ).toBe(false);
});
