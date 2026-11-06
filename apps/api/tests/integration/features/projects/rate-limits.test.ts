import { createLogger } from "@kithwork/logging";
import { expect, it } from "vitest";
import { createApi } from "../../../../src/app.js";
import { useProjectFixture } from "./fixtures.js";
const { f, teams, mutate } = useProjectFixture();

it("shares creation budgets across actors, instances and UUID casing without letting non-creators consume quota", async () => {
  const org = await f.create();
  await f.member(org, f.bob, "admin");
  await f.member(org, f.carol);
  const team = await teams.create(org);
  const config = f.config({ API_PROJECT_CREATION_RATE_LIMIT_MAX: "1" });
  const first = createApi({ config, logger: createLogger("silent") });
  const second = createApi({ config, logger: createLogger("silent") });
  const input = {
    organisationId: org.id,
    name: "Quota launch",
    teamIds: [team.id],
  };
  try {
    await Promise.all([first.ready(), second.ready()]);
    expect((await mutate("create", input, f.carol, first)).statusCode).toBe(
      403,
    );
    expect((await mutate("create", input, f.alice, first)).statusCode).toBe(
      200,
    );
    expect(
      (
        await mutate(
          "create",
          { ...input, organisationId: org.id.toUpperCase() },
          f.bob,
          second,
        )
      ).statusCode,
    ).toBe(429);
    const other = await f.create(f.bob);
    const otherTeam = await teams.create(other, { key: "OTHER" }, f.bob);
    expect(
      (
        await mutate(
          "create",
          { ...input, organisationId: other.id, teamIds: [otherTeam.id] },
          f.bob,
          first,
        )
      ).statusCode,
    ).toBe(429);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

it("counts every project creation in a batch", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const instance = createApi({
    config: f.config({ API_PROJECT_CREATION_RATE_LIMIT_MAX: "1" }),
    logger: createLogger("silent"),
  });
  try {
    await instance.ready();
    const input = {
      organisationId: org.id,
      name: "Batched launch",
      teamIds: [team.id],
    };
    const response = await instance.inject({
      method: "POST",
      url: "/trpc/organisations.projects.create,organisations.projects.create?batch=1",
      headers: { origin: f.webOrigin, cookie: f.alice.cookie },
      payload: { 0: input, 1: input },
    });
    expect(response.statusCode, response.body).toBe(207);
    const results =
      response.json<
        { result?: unknown; error?: { data: { httpStatus: number } } }[]
      >();
    expect(results.filter((r) => r.result)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.data.httpStatus).toBe(429);
  } finally {
    await instance.close();
  }
});
