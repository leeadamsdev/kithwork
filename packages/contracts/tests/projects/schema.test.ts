import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  setProjectTeamsInputSchema,
  projectPageInputSchema,
} from "../../src/index.js";

const organisationId = randomUUID();
const teamId = randomUUID();
const base = { organisationId, name: " Launch ", teamIds: [teamId] };
it("normalises project inputs and validates real calendar dates and team sets", () => {
  expect(createProjectInputSchema.parse(base)).toEqual({
    ...base,
    name: "Launch",
    description: null,
    status: "planned",
    startDate: null,
    targetDate: null,
  });
  for (const patch of [
    { teamIds: [] },
    { teamIds: [teamId, teamId] },
    { teamIds: Array.from({ length: 101 }, () => randomUUID()) },
    { name: " " },
    { description: "x".repeat(2001) },
    { status: "unknown" },
    { startDate: "2026-02-29" },
    { targetDate: "2026-04-31" },
    { startDate: "2026-04-02", targetDate: "2026-04-01" },
    { startDate: "2026-01-01T00:00:00Z" },
    { visibility: "private" },
  ])
    expect(
      createProjectInputSchema.safeParse({ ...base, ...patch }).success,
    ).toBe(false);
  expect(
    createProjectInputSchema.parse({
      ...base,
      startDate: "2028-02-29",
      targetDate: "2028-02-29",
    }).startDate,
  ).toBe("2028-02-29");
});
it("keeps patches strict and leaves merged date validation to the command", () => {
  const input = { organisationId, projectId: randomUUID(), expectedVersion: 1 };
  expect(updateProjectInputSchema.safeParse(input).success).toBe(false);
  expect(
    updateProjectInputSchema.parse({ ...input, description: " " }).description,
  ).toBeNull();
  expect(
    updateProjectInputSchema.parse({ ...input, targetDate: null }).targetDate,
  ).toBeNull();
  expect(
    updateProjectInputSchema.safeParse({ ...input, teamIds: [teamId] }).success,
  ).toBe(false);
  expect(
    setProjectTeamsInputSchema.safeParse({ ...input, teamIds: [] }).success,
  ).toBe(false);
  expect(projectPageInputSchema.parse({ organisationId })).toEqual({
    organisationId,
    limit: 50,
    archived: "exclude",
  });
});

it("normalises UUID casing before detecting duplicate team identities", () => {
  expect(
    createProjectInputSchema.parse({ ...base, teamIds: [teamId.toUpperCase()] })
      .teamIds,
  ).toEqual([teamId]);
  expect(
    createProjectInputSchema.safeParse({
      ...base,
      teamIds: [teamId, teamId.toUpperCase()],
    }).success,
  ).toBe(false);
});
it("rejects year zero dates that PostgreSQL cannot store", () => {
  expect(
    createProjectInputSchema.safeParse({ ...base, startDate: "0000-01-01" })
      .success,
  ).toBe(false);
  expect(
    updateProjectInputSchema.safeParse({
      organisationId,
      projectId: randomUUID(),
      expectedVersion: 1,
      targetDate: "0000-12-31",
    }).success,
  ).toBe(false);
});
