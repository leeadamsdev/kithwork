import { createLogger } from "@kithwork/logging";
import { expect, it } from "vitest";
import { createApi } from "../../../../src/app.js";
import { useIssueFixture } from "./fixtures.js";
const { f, teams } = useIssueFixture();

it("shares actor and canonical organisation creation quotas across instances after permission checks", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    hidden = await teams.create(org, { key: "SEC", visibility: "private" });
  const config = f.config({
    API_ISSUE_CREATION_ACTOR_RATE_LIMIT_MAX: "1",
    API_ISSUE_CREATION_ORGANISATION_RATE_LIMIT_MAX: "2",
  });
  const first = createApi({ config, logger: createLogger("silent") }),
    second = createApi({ config, logger: createLogger("silent") });
  const input = { organisationId: org.id, teamId: team.id, title: "Quota" };
  try {
    await Promise.all([first.ready(), second.ready()]);
    expect(
      (
        await f.mutate(
          "organisations.issues.create",
          { ...input, teamId: hidden.id },
          f.bob,
          first,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await f.mutate("organisations.issues.create", input, f.bob, first))
        .statusCode,
    ).toBe(200);
    expect(
      (await f.mutate("organisations.issues.create", input, f.bob, second))
        .statusCode,
    ).toBe(429);
    expect(
      (await f.mutate("organisations.issues.create", input, f.alice, second))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await f.mutate(
          "organisations.issues.create",
          { ...input, organisationId: org.id.toUpperCase() },
          f.carol,
          first,
        )
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await f.query(
          "organisations.issues.list",
          { organisationId: org.id },
          f.bob,
          second,
        )
      ).statusCode,
    ).toBe(200);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
