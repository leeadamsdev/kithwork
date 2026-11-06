import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IssueComment } from "@kithwork/contracts";
import { useCommentFixture } from "./fixtures.js";
const { f, teams, issues, create, query, mutate } = useCommentFixture();

it("allows author edits and author/manager deletion without permitting managers to rewrite others", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const comment = await create(scope, "Authored by Bob", f.bob),
    input = { ...scope, commentId: comment.id, expectedVersion: 1 };
  expect(
    (await mutate("update", { ...input, body: "Owner rewrite" }, f.alice))
      .statusCode,
  ).toBe(403);
  expect(
    (await mutate("update", { ...input, body: "Peer rewrite" }, f.carol))
      .statusCode,
  ).toBe(403);
  expect((await mutate("delete", input, f.carol)).statusCode).toBe(403);
  const read = await query("get", { ...scope, commentId: comment.id }, f.carol);
  expect(read.statusCode, read.body).toBe(200);
  expect(f.data<IssueComment>(read).capabilities).toEqual({
    canEdit: false,
    canDelete: false,
  });
  await teams.mutate(
    "members.add",
    {
      organisationId: org.id,
      teamId: team.id,
      userId: f.carol.id,
      role: "maintainer",
    },
    f.alice,
  );
  expect(
    (await mutate("update", { ...input, body: "Maintainer rewrite" }, f.carol))
      .statusCode,
  ).toBe(403);
  expect((await mutate("delete", input, f.carol)).statusCode).toBe(200);
  expect((await mutate("delete", input, f.bob)).statusCode).toBe(200);
  await teams.mutate(
    "members.remove",
    { organisationId: org.id, teamId: team.id, userId: f.carol.id },
    f.alice,
  );
  expect((await mutate("delete", input, f.carol)).statusCode).toBe(403);
});

it("protects private/cross-tenant/parent scopes and freezes edits while allowing archived moderation", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org, { visibility: "private" });
  await teams.mutate(
    "members.add",
    { organisationId: org.id, teamId: team.id, userId: f.bob.id },
    f.alice,
  );
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    scope = { organisationId: org.id, issueId: issue.id };
  const comment = await create(scope, "Private discussion", f.bob),
    input = { ...scope, commentId: comment.id, expectedVersion: 1 };
  const another = await issues.create({
    organisationId: org.id,
    teamId: team.id,
  });
  const readInput = { ...scope, commentId: comment.id };
  expect(
    (await query("get", { ...readInput, issueId: another.id }, f.alice))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await query(
        "get",
        { ...readInput, organisationId: randomUUID() },
        f.alice,
      )
    ).statusCode,
  ).toBe(404);
  expect((await query("get", readInput)).statusCode).toBe(401);
  expect((await query("get", readInput, f.carol)).statusCode).toBe(404);
  await teams.mutate(
    "members.remove",
    { organisationId: org.id, teamId: team.id, userId: f.bob.id },
    f.alice,
  );
  for (const path of ["get", "list"])
    expect(
      (await query(path, path === "list" ? scope : readInput, f.bob))
        .statusCode,
    ).toBe(404);
  expect((await mutate("delete", input, f.bob)).statusCode).toBe(404);
  expect(
    (await mutate("update", { ...input, body: "Revoked" }, f.bob)).statusCode,
  ).toBe(404);
  await issues.mutate("archive", { ...scope, expectedVersion: 1 }, f.alice);
  expect(
    (
      await mutate(
        "create",
        { ...scope, creationKey: randomUUID(), body: "Frozen" },
        f.alice,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (await mutate("update", { ...input, body: "Frozen" }, f.bob)).statusCode,
  ).toBe(404);
  await teams.mutate(
    "members.add",
    { organisationId: org.id, teamId: team.id, userId: f.bob.id },
    f.alice,
  );
  expect(
    (await mutate("update", { ...input, body: "Frozen" }, f.bob)).statusCode,
  ).toBe(409);
  const read = await query("get", readInput, f.bob);
  expect(f.data<IssueComment>(read).capabilities).toEqual({
    canEdit: false,
    canDelete: true,
  });
  await teams.mutate(
    "archive",
    { organisationId: org.id, teamId: team.id, expectedVersion: 1 },
    f.alice,
  );
  const deleted = await mutate("delete", input, f.bob);
  expect(deleted.statusCode, deleted.body).toBe(200);
  expect(f.data<IssueComment>(deleted).body).toBeNull();
});
