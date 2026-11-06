import { randomUUID } from "node:crypto";
import { createLogger } from "@kithwork/logging";
import { expect, it } from "vitest";
import { createApi } from "../../../../src/app.js";
import { useTeamFixture } from "./fixtures.js";
const { f, mutate } = useTeamFixture();
it("shares actor and organisation creation budgets across instances without letting ordinary members consume them", async () => {
  const org = await f.create();
  await f.member(org, f.bob, "admin");
  await f.member(org, f.carol);
  const config = f.config({ API_TEAM_CREATION_RATE_LIMIT_MAX: "1" });
  const first = createApi({ config, logger: createLogger("silent") }),
    second = createApi({ config, logger: createLogger("silent") });
  const input = (organisationId = org.id) => ({
    organisationId,
    key: "Q" + randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase(),
    name: "Quota",
  });
  try {
    await Promise.all([first.ready(), second.ready()]);
    expect((await mutate("create", input(), f.carol, first)).statusCode).toBe(
      403,
    );
    expect((await mutate("create", input(), f.alice, first)).statusCode).toBe(
      200,
    );
    expect((await mutate("create", input(), f.bob, second)).statusCode).toBe(
      429,
    );
    const other = await f.create(f.bob);
    expect(
      (await mutate("create", input(other.id), f.bob, first)).statusCode,
    ).toBe(429);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

it("counts every team creation in a batched request", async () => {
  const org = await f.create();
  const instance = createApi({
    config: f.config({ API_TEAM_CREATION_RATE_LIMIT_MAX: "1" }),
    logger: createLogger("silent"),
  });
  try {
    await instance.ready();
    const response = await instance.inject({
      method: "POST",
      url: "/trpc/organisations.teams.create,organisations.teams.create?batch=1",
      headers: { origin: f.webOrigin, cookie: f.alice.cookie },
      payload: {
        0: { organisationId: org.id, key: "ONE", name: "One" },
        1: { organisationId: org.id, key: "TWO", name: "Two" },
      },
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
