import { expect, it } from "vitest";
import type { Workflow, IssueDetail } from "@kithwork/contracts";
import { useIssueFixture } from "./fixtures.js";
const { f, teams, create, get, mutate } = useIssueFixture();

it("retains retired statuses on existing issues and requires active replacements for restoration", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const scope = { organisationId: org.id, teamId: team.id };
  const workflow = f.data<Workflow>(
    await f.mutate(
      "organisations.teams.workflow.statuses.create",
      {
        ...scope,
        expectedWorkflowVersion: 1,
        name: "Review",
        category: "started",
      },
      f.alice,
    ),
  );
  const review = workflow.statuses.find((s) => s.name === "Review")!;
  const issue = await create(scope, { statusId: review.id });
  const input = {
    organisationId: org.id,
    issueId: issue.id,
    expectedVersion: 1,
  };
  expect(
    (
      await f.mutate(
        "organisations.teams.workflow.statuses.retire",
        { ...scope, statusId: review.id, expectedWorkflowVersion: 2 },
        f.alice,
      )
    ).statusCode,
  ).toBe(200);
  expect((await get(input)).status.retiredAt).not.toBeNull();
  expect(
    (
      await mutate(
        "update",
        { ...input, statusId: review.id.toUpperCase(), title: "Retained" },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await mutate(
        "create",
        { ...scope, title: "Denied", statusId: review.id },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (await mutate("archive", { ...input, expectedVersion: 2 }, f.bob))
      .statusCode,
  ).toBe(403);
  expect(
    (await mutate("archive", { ...input, expectedVersion: 2 }, f.alice))
      .statusCode,
  ).toBe(200);
  expect((await mutate("archive", input, f.alice)).statusCode).toBe(200);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 3, title: "Frozen" },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (await mutate("restore", { ...input, expectedVersion: 3 }, f.alice))
      .statusCode,
  ).toBe(409);
  const restored = await mutate(
    "restore",
    {
      ...input,
      expectedVersion: 3,
      statusId: workflow.statuses.find((s) => s.category === "completed")!.id,
    },
    f.alice,
  );
  expect(restored.statusCode, restored.body).toBe(200);
  expect(f.data<IssueDetail>(restored)).toMatchObject({
    version: 4,
    archivedAt: null,
    status: { category: "completed" },
  });
  expect((await mutate("restore", input, f.alice)).statusCode).toBe(200);
  expect(
    (await teams.mutate("archive", { ...scope, expectedVersion: 1 }, f.alice))
      .statusCode,
  ).toBe(200);
  expect((await get(input)).capabilities).toEqual({
    canEdit: false,
    canArchive: false,
    canRestore: false,
  });
  expect(
    (await mutate("archive", { ...input, expectedVersion: 4 }, f.alice))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "update",
        { ...input, expectedVersion: 4, title: "Frozen team" },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
});
