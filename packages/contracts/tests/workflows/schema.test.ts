import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createWorkflowStatusInputSchema,
  updateWorkflowStatusInputSchema,
  reorderWorkflowStatusesInputSchema,
  workflowStatusPageInputSchema,
} from "../../src/index.js";

const base = {
  organisationId: randomUUID(),
  teamId: randomUUID(),
  expectedWorkflowVersion: 1,
};
it("normalises workflow names/descriptions and rejects unmanaged or invalid properties", () => {
  expect(
    createWorkflowStatusInputSchema.parse({
      ...base,
      name: " In Review ",
      category: "started",
      description: " ",
    }),
  ).toEqual({
    ...base,
    name: "In Review",
    category: "started",
    description: null,
  });
  for (const patch of [
    { name: " " },
    { name: "x".repeat(51) },
    { description: "x".repeat(501) },
    { category: "unknown" },
    { isDefault: true },
    { position: 1 },
    { expectedWorkflowVersion: 0 },
    { expectedWorkflowVersion: 2147483648 },
  ])
    expect(
      createWorkflowStatusInputSchema.safeParse({
        ...base,
        name: "Review",
        category: "started",
        ...patch,
      }).success,
    ).toBe(false);
  const target = { ...base, statusId: randomUUID() };
  expect(updateWorkflowStatusInputSchema.safeParse(target).success).toBe(false);
  expect(
    updateWorkflowStatusInputSchema.parse({ ...target, description: null })
      .description,
  ).toBeNull();
  expect(
    updateWorkflowStatusInputSchema.safeParse({
      ...target,
      category: "completed",
    }).success,
  ).toBe(false);
  expect(
    workflowStatusPageInputSchema.parse({
      organisationId: base.organisationId,
      teamId: base.teamId,
    }),
  ).toEqual({
    organisationId: base.organisationId,
    teamId: base.teamId,
    retired: "exclude",
    limit: 50,
  });
});
it("canonicalises reorder identities before checking uniqueness and bounds", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  expect(
    reorderWorkflowStatusesInputSchema.parse({
      ...base,
      category: "started",
      statusIds: [id.toUpperCase()],
    }).statusIds,
  ).toEqual([id]);
  for (const statusIds of [
    [],
    [id, id.toUpperCase()],
    Array.from({ length: 51 }, () => randomUUID()),
  ])
    expect(
      reorderWorkflowStatusesInputSchema.safeParse({
        ...base,
        category: "started",
        statusIds,
      }).success,
    ).toBe(false);
});
