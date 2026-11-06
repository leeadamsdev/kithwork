import { expect, it } from "vitest";
import type { Workflow } from "@kithwork/contracts";
import { useWorkflowFixture } from "./fixtures.js";
const { f, teams, get, mutate } = useWorkflowFixture();

it("bootstraps the default workflow and versions custom status updates independently of team metadata", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const target = { organisationId: org.id, teamId: team.id };
  const initial = await get(target);
  expect(initial).toMatchObject({
    ...target,
    version: 1,
    capabilities: { canManage: true },
  });
  expect(
    initial.statuses.map((s) => [s.name, s.category, s.position, s.isDefault]),
  ).toEqual([
    ["Backlog", "backlog", 0, true],
    ["Todo", "unstarted", 0, false],
    ["In Progress", "started", 0, false],
    ["Done", "completed", 0, false],
    ["Cancelled", "cancelled", 0, false],
  ]);
  const created = await mutate(
    "create",
    {
      ...target,
      expectedWorkflowVersion: 1,
      category: "started",
      name: " In Review ",
    },
    f.alice,
  );
  expect(created.statusCode, created.body).toBe(200);
  const workflow = f.data<Workflow>(created);
  expect(workflow.version).toBe(2);
  const status = workflow.statuses.find((s) => s.name === "In Review")!;
  expect(status).toMatchObject({
    category: "started",
    position: 1,
    isDefault: false,
    description: null,
    retiredAt: null,
  });
  const input = { ...target, statusId: status.id, expectedWorkflowVersion: 2 };
  const updated = await mutate(
    "update",
    { ...input, name: "Ready to Merge", description: "Reviewed" },
    f.alice,
  );
  expect(updated.statusCode, updated.body).toBe(200);
  expect(f.data<Workflow>(updated).version).toBe(3);
  expect(
    (await mutate("update", { ...input, name: "Stale" }, f.alice)).statusCode,
  ).toBe(409);
  const noOp = await mutate(
    "update",
    {
      ...input,
      expectedWorkflowVersion: 3,
      name: "Ready to Merge",
      description: "Reviewed",
    },
    f.alice,
  );
  expect(noOp.statusCode, noOp.body).toBe(200);
  expect(f.data<Workflow>(noOp).version).toBe(3);
  expect(
    (
      await mutate(
        "create",
        {
          ...target,
          expectedWorkflowVersion: 3,
          name: " ready to merge ",
          category: "completed",
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (await teams.query("get", target, f.alice)).json<{
      result: { data: { version: number } };
    }>().result.data.version,
  ).toBe(1);
});
