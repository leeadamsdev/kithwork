import { expect, it } from "vitest";
import type { Team } from "@kithwork/contracts";
import { useTeamFixture } from "./fixtures.js";

const { f, create, query, mutate } = useTeamFixture();

it("delegates maintenance without granting organisation administration or privacy powers", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await create(org, { visibility: "private" });
  const input = { organisationId: org.id, teamId: team.id };
  expect(
    (
      await mutate(
        "members.add",
        { ...input, userId: f.bob.id, role: "maintainer" },
        f.alice,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await mutate("members.add", { ...input, userId: f.carol.id }, f.bob))
      .statusCode,
  ).toBe(200);
  const edited = await mutate(
    "update",
    { ...input, expectedVersion: 1, name: "Maintained" },
    f.bob,
  );
  expect(edited.statusCode, edited.body).toBe(200);
  expect(f.data<Team>(edited).capabilities).toMatchObject({
    canEdit: true,
    canChangeVisibility: false,
    canArchive: false,
  });
  for (const path of ["archive", "setVisibility"])
    expect(
      (
        await mutate(
          path,
          {
            ...input,
            expectedVersion: 2,
            ...(path === "setVisibility" ? { visibility: "organisation" } : {}),
          },
          f.bob,
        )
      ).statusCode,
    ).toBe(403);
  expect(
    (
      await mutate(
        "members.changeRole",
        { ...input, userId: f.bob.id, role: "maintainer" },
        f.carol,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await f.mutate(
        "organisations.update",
        { organisationId: org.id, name: "Escalated" },
        f.bob,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await mutate(
        "members.add",
        { ...input, userId: f.carol.id, role: "maintainer" },
        f.bob,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "members.changeRole",
        { ...input, userId: f.carol.id, role: "maintainer" },
        f.bob,
      )
    ).statusCode,
  ).toBe(200);
  const page = await query("members.list", input, f.carol);
  expect(page.statusCode).toBe(200);
  expect(page.body).not.toContain(f.bob.email);
});

it("lets people self-join visible teams without upserting or escalating their role", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await create(org);
  const input = { organisationId: org.id, teamId: team.id };
  const joined = await mutate("join", input, f.bob);
  expect(joined.statusCode, joined.body).toBe(200);
  expect(f.data<{ role: string }>(joined).role).toBe("member");
  expect(
    (await mutate("join", { ...input, role: "maintainer" }, f.bob)).statusCode,
  ).toBe(400);
  expect(
    f.data<{ role: string }>(await mutate("join", input, f.alice)).role,
  ).toBe("maintainer");
  expect((await mutate("leave", input, f.alice)).statusCode).toBe(200);
  expect(
    (await mutate("members.remove", { ...input, userId: f.bob.id }, f.alice))
      .statusCode,
  ).toBe(200);
  expect(
    (await f.query("organisations.get", { organisationId: org.id }, f.bob))
      .statusCode,
  ).toBe(200);
});

it("does not permit private self-join or foreign-organisation membership targets", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await create(org, { visibility: "private" });
  const input = { organisationId: org.id, teamId: team.id };
  expect((await mutate("join", input, f.bob)).statusCode).toBe(404);
  expect(
    (await mutate("members.add", { ...input, userId: f.carol.id }, f.alice))
      .statusCode,
  ).toBe(404);
  await f.member(org, f.carol, "admin");
  expect((await query("get", input, f.carol)).statusCode).toBe(200);
  expect((await mutate("join", input, f.carol)).statusCode).toBe(403);
  expect(
    (await mutate("members.add", { ...input, userId: f.carol.id }, f.carol))
      .statusCode,
  ).toBe(200);
});

it("keeps archived membership changes frozen while permitting access revocation", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await create(org, { visibility: "private" });
  const input = { organisationId: org.id, teamId: team.id };
  await mutate(
    "members.add",
    { ...input, userId: f.bob.id, role: "maintainer" },
    f.alice,
  );
  await mutate("archive", { ...input, expectedVersion: 1 }, f.alice);
  expect(
    (await mutate("members.add", { ...input, userId: f.carol.id }, f.bob))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await mutate(
        "members.changeRole",
        { ...input, userId: f.bob.id, role: "member" },
        f.bob,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (await mutate("members.remove", { ...input, userId: f.alice.id }, f.bob))
      .statusCode,
  ).toBe(200);
  expect((await mutate("leave", input, f.bob)).statusCode).toBe(200);
  expect((await query("get", input, f.bob)).statusCode).toBe(404);
  expect((await query("get", input, f.alice)).statusCode).toBe(200);
});

it("cascades organisation leave/removal without restoring private access on a later rejoin", async () => {
  for (const leaving of [true, false]) {
    const org = await f.create();
    await f.member(org, f.bob);
    const team = await create(org, { visibility: "private" });
    const input = { organisationId: org.id, teamId: team.id };
    await mutate(
      "members.add",
      { ...input, userId: f.bob.id, role: "maintainer" },
      f.alice,
    );
    const removed = await f.mutate(
      leaving ? "organisations.leave" : "organisations.members.remove",
      { organisationId: org.id, ...(leaving ? {} : { userId: f.bob.id }) },
      leaving ? f.bob : f.alice,
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(
      (
        await f.database.pool.query(
          "SELECT user_id FROM team_member WHERE organisation_id=$1 AND user_id=$2",
          [org.id, f.bob.id],
        )
      ).rowCount,
    ).toBe(0);
    await f.member(org, f.bob);
    expect((await query("get", input, f.bob)).statusCode).toBe(404);
  }
});
