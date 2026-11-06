import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../../src/app.js";
import { useCommentFixture } from "./fixtures.js";
const { f, teams, issues, create } = useCommentFixture();

it("counts each comment creation in a batched RPC request", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id };
  const app = createApi({
    config: f.config({ API_COMMENT_CREATION_ACTOR_RATE_LIMIT_MAX: "1" }),
    logger: createLogger("silent"),
  });
  try {
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/trpc/organisations.issues.comments.create,organisations.issues.comments.create?batch=1",
      headers: { origin: f.webOrigin, cookie: f.alice.cookie },
      payload: {
        0: { ...scope, creationKey: randomUUID(), body: "First" },
        1: { ...scope, creationKey: randomUUID(), body: "Second" },
      },
    });
    expect(response.statusCode, response.body).toBe(207);
    const results =
      response.json<
        { result?: unknown; error?: { data: { httpStatus: number } } }[]
      >();
    expect(results.filter((row) => row.result)).toHaveLength(1);
    expect(results.find((row) => row.error)?.error?.data.httpStatus).toBe(429);
  } finally {
    await app.close();
  }
});

it("shares canonical actor/organisation creation budgets across API instances after visible active prechecks", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    hidden = await teams.create(org, { key: "SEC", visibility: "private" });
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    privateIssue = await issues.create({
      organisationId: org.id,
      teamId: hidden.id,
    });
  const scope = { organisationId: org.id, issueId: issue.id },
    config = f.config({
      API_COMMENT_CREATION_ACTOR_RATE_LIMIT_MAX: "1",
      API_COMMENT_CREATION_ORGANISATION_RATE_LIMIT_MAX: "2",
    });
  const first = createApi({ config, logger: createLogger("silent") }),
    second = createApi({ config, logger: createLogger("silent") });
  const post = (instance: typeof first, actor: typeof f.alice, fields = {}) =>
    f.mutate(
      "organisations.issues.comments.create",
      { ...scope, body: "Quota", creationKey: randomUUID(), ...fields },
      actor,
      instance,
    );
  try {
    await Promise.all([first.ready(), second.ready()]);
    expect(
      (await post(first, f.bob, { issueId: privateIssue.id })).statusCode,
    ).toBe(404);
    expect((await post(first, f.bob)).statusCode).toBe(200);
    expect((await post(second, f.bob)).statusCode).toBe(429);
    expect((await post(second, f.alice)).statusCode).toBe(200);
    expect(
      (await post(first, f.carol, { organisationId: org.id.toUpperCase() }))
        .statusCode,
    ).toBe(429);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

it("does not consume creation budget on archived targets and keeps deletion available after edit throttling", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  const issue = await issues.create({
      organisationId: org.id,
      teamId: team.id,
    }),
    archived = await issues.create({ organisationId: org.id, teamId: team.id });
  const scope = { organisationId: org.id, issueId: issue.id },
    comment = await create(scope, "Before limits", f.bob);
  await issues.mutate(
    "archive",
    { organisationId: org.id, issueId: archived.id, expectedVersion: 1 },
    f.alice,
  );
  const config = f.config({
    API_COMMENT_CREATION_ACTOR_RATE_LIMIT_MAX: "1",
    API_COMMENT_EDIT_RATE_LIMIT_MAX: "1",
  });
  const first = createApi({ config, logger: createLogger("silent") }),
    second = createApi({ config, logger: createLogger("silent") });
  const write = (instance: typeof first, path: string, input: unknown) =>
    f.mutate("organisations.issues.comments." + path, input, f.bob, instance);
  try {
    await Promise.all([first.ready(), second.ready()]);
    expect(
      (
        await write(first, "create", {
          ...scope,
          issueId: archived.id,
          body: "Frozen",
          creationKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await write(first, "create", {
          ...scope,
          body: "One new comment",
          creationKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await write(second, "create", {
          ...scope,
          body: "Limited",
          creationKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(429);
    const input = { ...scope, commentId: comment.id, expectedVersion: 1 };
    expect(
      (await write(first, "update", { ...input, body: "One edit" })).statusCode,
    ).toBe(200);
    expect(
      (
        await write(second, "update", {
          ...input,
          expectedVersion: 2,
          body: "Limited",
        })
      ).statusCode,
    ).toBe(429);
    const deleted = await write(second, "delete", {
      ...input,
      expectedVersion: 2,
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(
      (await f.query("organisations.issues.comments.list", scope, f.bob, first))
        .statusCode,
    ).toBe(200);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
