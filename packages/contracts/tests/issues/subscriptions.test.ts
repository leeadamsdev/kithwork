import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import * as c from "../../src/index.js";

it("accepts only self-service desired-state following changes", () => {
  const scope = { organisationId: randomUUID(), issueId: randomUUID() };
  expect(
    c.setIssueFollowingInputSchema.parse({ ...scope, following: false }),
  ).toEqual({ ...scope, following: false });
  for (const extra of [
    { userId: randomUUID() },
    { following: "false" },
    { expectedVersion: 1 },
  ])
    expect(
      c.setIssueFollowingInputSchema.safeParse({
        ...scope,
        following: true,
        ...extra,
      }).success,
    ).toBe(false);
  expect(c.issueFollowingSchema.parse({ ...scope, following: true })).toEqual({
    ...scope,
    following: true,
  });
});

it("bounds and normalises mention target selection without accepting another person's state", () => {
  const scope = { organisationId: randomUUID(), teamId: randomUUID() };
  expect(
    c.issueMentionTargetsInputSchema.parse({ ...scope, prefix: "  Al_%  " }),
  ).toMatchObject({ prefix: "Al_%", limit: 50 });
  for (const fields of [
    { prefix: "x".repeat(101) },
    { prefix: "x\u0000y" },
    { limit: 101 },
    { userId: randomUUID() },
  ])
    expect(
      c.issueMentionTargetsInputSchema.safeParse({ ...scope, ...fields })
        .success,
    ).toBe(false);
});
