import { expect, it } from "vitest";
import { useWorkflowFixture } from "./fixtures.js";

const { f, teams, get, change, mutate } = useWorkflowFixture();

it("bounds active statuses across creation and restoration without limiting retired history", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  await f.database.pool.query(
    "INSERT INTO workflow_status(organisation_id,team_id,name,category,position) SELECT $1,$2,'Extra '||n,'started',n FROM generate_series(1,45) n",
    [org.id, team.id],
  );
  const workflow = await get(scope);
  expect(workflow.statuses).toHaveLength(50);
  expect(
    (
      await mutate(
        "create",
        {
          ...scope,
          expectedWorkflowVersion: 1,
          name: "Too many",
          category: "started",
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  const statusId = workflow.statuses.find((s) => s.name === "Extra 1")!.id;
  await change("retire", { ...scope, expectedWorkflowVersion: 1, statusId });
  await change("create", {
    ...scope,
    expectedWorkflowVersion: 2,
    name: "Replacement",
    category: "started",
  });
  expect(
    (
      await mutate(
        "restore",
        { ...scope, expectedWorkflowVersion: 3, statusId },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect((await get(scope)).version).toBe(3);
  expect((await get(scope)).statuses).toHaveLength(50);
});

it("rolls back changes at version exhaustion and maps duplicate renames to conflicts", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const workflow = await get(scope);
  const todo = workflow.statuses.find((s) => s.category === "unstarted")!;
  expect(
    (
      await mutate(
        "update",
        {
          ...scope,
          expectedWorkflowVersion: 1,
          statusId: todo.id,
          name: " backlog ",
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  await f.database.pool.query(
    "UPDATE team_workflow SET version=2147483647 WHERE team_id=$1",
    [team.id],
  );
  expect(
    (
      await mutate(
        "update",
        {
          ...scope,
          expectedWorkflowVersion: 2147483647,
          statusId: todo.id,
          name: "Cannot persist",
        },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(await get(scope)).toEqual({ ...workflow, version: 2147483647 });
});
