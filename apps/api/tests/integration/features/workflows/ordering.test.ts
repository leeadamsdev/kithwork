import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { WorkflowStatusPage } from "@kithwork/contracts";
import { useWorkflowFixture } from "./fixtures.js";
const { f, teams, change, get, mutate, query } = useWorkflowFixture();

it("reorders only a complete active category and paginates retained statuses", async () => {
  const org = await f.create(),
    team = await teams.create(org);
  const target = { organisationId: org.id, teamId: team.id };
  const created = await change("create", {
    ...target,
    expectedWorkflowVersion: 1,
    category: "started",
    name: "Review",
  });
  const progress = created.statuses.find((s) => s.name === "In Progress")!,
    review = created.statuses.find((s) => s.name === "Review")!;
  for (const statusIds of [
    [review.id],
    [progress.id, randomUUID()],
    [created.statuses[0]!.id, review.id],
  ])
    expect(
      (
        await mutate(
          "reorder",
          {
            ...target,
            expectedWorkflowVersion: 2,
            category: "started",
            statusIds,
          },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
  const reordered = await change("reorder", {
    ...target,
    expectedWorkflowVersion: 2,
    category: "started",
    statusIds: [review.id.toUpperCase(), progress.id],
  });
  expect(reordered.version).toBe(3);
  expect(
    reordered.statuses
      .filter((s) => s.category === "started")
      .map((s) => [s.id, s.position]),
  ).toEqual([
    [review.id, 0],
    [progress.id, 1],
  ]);
  expect(
    (
      await change("reorder", {
        ...target,
        expectedWorkflowVersion: 3,
        category: "started",
        statusIds: [review.id, progress.id],
      })
    ).version,
  ).toBe(3);
  const page1 = f.data<WorkflowStatusPage>(
    await query(
      "statuses.list",
      { ...target, limit: 3, retired: "include" },
      f.alice,
    ),
  );
  const page2 = f.data<WorkflowStatusPage>(
    await query(
      "statuses.list",
      { ...target, limit: 3, retired: "include", cursor: page1.nextCursor },
      f.alice,
    ),
  );
  expect([...page1.items, ...page2.items].map((s) => s.id).sort()).toEqual(
    (await get(target)).statuses.map((s) => s.id).sort(),
  );
  expect(page2.nextCursor).toBeNull();
  expect(page1.version).toBe(3);
});
