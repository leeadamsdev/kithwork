import { expect, it } from "vitest";
import { useWorkflowFixture } from "./fixtures.js";
const { f, teams, get, change, mutate, query } = useWorkflowFixture();

it("keeps private workflows scoped, delegates settings and freezes archived teams", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol, "admin");
  const shared = await teams.create(org),
    hidden = await teams.create(org, { key: "SECRET", visibility: "private" });
  const target = { organisationId: org.id, teamId: hidden.id };
  expect(
    (await get({ ...target, teamId: shared.id }, f.bob)).capabilities.canManage,
  ).toBe(false);
  expect((await query("get", target, f.bob)).statusCode).toBe(404);
  expect((await query("statuses.list", target, f.bob)).statusCode).toBe(404);
  expect((await query("get", target)).statusCode).toBe(401);
  const publicPayload = {
    organisationId: org.id,
    teamId: shared.id,
    expectedWorkflowVersion: 1,
    category: "started",
    name: "Denied",
  };
  expect((await mutate("create", publicPayload, f.bob)).statusCode).toBe(403);
  expect(
    (await mutate("create", { ...publicPayload, teamId: hidden.id }, f.bob))
      .statusCode,
  ).toBe(404);
  await teams.mutate(
    "members.add",
    { ...target, userId: f.bob.id, role: "maintainer" },
    f.alice,
  );
  const custom = await change(
    "create",
    {
      ...target,
      expectedWorkflowVersion: 1,
      category: "started",
      name: "Review",
    },
    f.bob,
  );
  const status = custom.statuses.find((s) => s.name === "Review")!;
  expect((await get(target, f.carol)).capabilities.canManage).toBe(true);
  expect(
    (
      await mutate(
        "update",
        {
          ...target,
          teamId: shared.id,
          expectedWorkflowVersion: 1,
          statusId: status.id,
          name: "Foreign",
        },
        f.carol,
      )
    ).statusCode,
  ).toBe(404);
  await teams.mutate("archive", { ...target, expectedVersion: 1 }, f.alice);
  expect((await get(target, f.bob)).capabilities.canManage).toBe(false);
  for (const [path, input] of [
    ["create", { category: "started", name: "Frozen" }],
    ["update", { statusId: status.id, name: "Frozen" }],
    ["setDefault", { statusId: custom.statuses[0]!.id }],
    ["retire", { statusId: status.id }],
    ["restore", { statusId: status.id }],
    [
      "reorder",
      {
        category: "started",
        statusIds: custom.statuses
          .filter((s) => s.category === "started")
          .map((s) => s.id),
      },
    ],
  ] as const)
    expect(
      (
        await mutate(
          path,
          { ...target, expectedWorkflowVersion: 2, ...input },
          f.bob,
        )
      ).statusCode,
    ).toBe(409);
  await teams.mutate(
    "members.remove",
    { ...target, userId: f.bob.id },
    f.alice,
  );
  expect((await query("get", target, f.bob)).statusCode).toBe(404);
  const foreignOrg = await f.create(f.bob);
  expect(
    (await query("get", { ...target, organisationId: foreignOrg.id }, f.bob))
      .statusCode,
  ).toBe(404);
});
