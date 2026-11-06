import { expect, it } from "vitest";
import type { WorkflowStatusPage } from "@kithwork/contracts";
import { useWorkflowFixture } from "./fixtures.js";
const { f, teams, get, change, mutate, query } = useWorkflowFixture();

it("preserves default/category safeguards, retired identities and empty-page versions", async () => {
  const org = await f.create(),
    team = await teams.create(org);
  const target = { organisationId: org.id, teamId: team.id };
  const initial = await get(target);
  const backlog = initial.statuses[0]!,
    todo = initial.statuses[1]!,
    started = initial.statuses[2]!,
    done = initial.statuses[3]!;
  await change("create", {
    ...target,
    expectedWorkflowVersion: 1,
    category: "backlog",
    name: "Icebox",
  });
  await change("create", {
    ...target,
    expectedWorkflowVersion: 2,
    category: "started",
    name: "Review",
  });
  expect(
    (
      await mutate(
        "setDefault",
        { ...target, expectedWorkflowVersion: 3, statusId: started.id },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  const updated = await change("setDefault", {
    ...target,
    expectedWorkflowVersion: 3,
    statusId: todo.id,
  });
  expect(updated.version).toBe(4);
  expect(updated.statuses.filter((s) => s.isDefault).map((s) => s.id)).toEqual([
    todo.id,
  ]);
  expect(
    (
      await change("setDefault", {
        ...target,
        expectedWorkflowVersion: 4,
        statusId: todo.id,
      })
    ).version,
  ).toBe(4);
  for (const statusId of [todo.id, done.id])
    expect(
      (
        await mutate(
          "retire",
          { ...target, expectedWorkflowVersion: 4, statusId },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
  expect(
    (
      await change("retire", {
        ...target,
        expectedWorkflowVersion: 4,
        statusId: backlog.id,
      })
    ).version,
  ).toBe(5);
  expect(
    (
      await change("retire", {
        ...target,
        expectedWorkflowVersion: 1,
        statusId: backlog.id,
      })
    ).version,
  ).toBe(5);
  expect(
    (
      await mutate(
        "update",
        {
          ...target,
          expectedWorkflowVersion: 5,
          statusId: backlog.id,
          name: "Frozen",
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "create",
        {
          ...target,
          expectedWorkflowVersion: 5,
          category: "backlog",
          name: "Backlog",
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  const retiredResponse = await query(
    "statuses.list",
    { ...target, retired: "only" },
    f.alice,
  );
  expect(retiredResponse.statusCode, retiredResponse.body).toBe(200);
  const retired = f.data<WorkflowStatusPage>(retiredResponse);
  expect(retired).toMatchObject({ version: 5, nextCursor: null });
  expect(retired.items.map((s) => s.id)).toEqual([backlog.id]);
  const empty = await query(
    "statuses.list",
    { ...target, retired: "only", cursor: backlog.id },
    f.alice,
  );
  expect(f.data<WorkflowStatusPage>(empty)).toEqual({
    version: 5,
    items: [],
    nextCursor: null,
  });
  const restored = await change("restore", {
    ...target,
    expectedWorkflowVersion: 5,
    statusId: backlog.id,
  });
  expect(restored.version).toBe(6);
  expect(
    restored.statuses
      .filter((s) => s.category === "backlog")
      .map((s) => [s.name, s.position]),
  ).toEqual([
    ["Icebox", 0],
    ["Backlog", 1],
  ]);
  expect(
    (
      await change("restore", {
        ...target,
        expectedWorkflowVersion: 1,
        statusId: backlog.id,
      })
    ).version,
  ).toBe(6);
});
