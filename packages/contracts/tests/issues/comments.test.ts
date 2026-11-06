import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import * as contracts from "../../src/index.js";

it("validates strict comment mutations while preserving Markdown whitespace", () => {
  const scope = { organisationId: randomUUID(), issueId: randomUUID() };
  const body = "  Code example\n\n    const value = 1;\n ";
  const input = { ...scope, creationKey: randomUUID(), body };
  expect(contracts.createIssueCommentInputSchema.parse(input)).toEqual(input);
  for (const invalid of ["", " \n\t", "x".repeat(20001)])
    expect(
      contracts.createIssueCommentInputSchema.safeParse({
        ...input,
        body: invalid,
      }).success,
    ).toBe(false);
  expect(
    contracts.createIssueCommentInputSchema.safeParse({
      ...input,
      authorId: randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    contracts.createIssueCommentInputSchema.safeParse({
      ...input,
      creationKey: undefined,
    }).success,
  ).toBe(false);
  const edit = { ...scope, commentId: randomUUID(), expectedVersion: 1, body };
  expect(contracts.updateIssueCommentInputSchema.parse(edit)).toEqual(edit);
  expect(contracts.deleteIssueCommentInputSchema.safeParse(edit).success).toBe(
    false,
  );
  expect(
    contracts.updateIssueCommentInputSchema.safeParse({
      ...edit,
      expectedVersion: 0,
    }).success,
  ).toBe(false);
});

it("bounds comment pagination and round-trips exact timestamp ties", () => {
  const scope = { organisationId: randomUUID(), issueId: randomUUID() };
  expect(contracts.issueCommentListInputSchema.parse(scope).limit).toBe(50);
  for (const limit of [0, 101])
    expect(
      contracts.issueCommentListInputSchema.safeParse({ ...scope, limit })
        .success,
    ).toBe(false);
  const cursor = { createdAt: "2026-11-06T12:00:00.123Z", id: randomUUID() };
  const encoded = contracts.encodeIssueCursor(cursor);
  expect(
    contracts.issueCommentListInputSchema.parse({ ...scope, cursor: encoded })
      .cursor,
  ).toEqual(cursor);
  expect(
    contracts.issueCommentListInputSchema.safeParse({
      ...scope,
      cursor: "invalid!",
    }).success,
  ).toBe(false);
});

it("rejects NUL characters before comment text reaches PostgreSQL", () => {
  const scope = { organisationId: randomUUID(), issueId: randomUUID() };
  for (const body of ["\u0000", "example\u0000text"]) {
    expect(
      contracts.createIssueCommentInputSchema.safeParse({
        ...scope,
        creationKey: randomUUID(),
        body,
      }).success,
    ).toBe(false);
    expect(
      contracts.updateIssueCommentInputSchema.safeParse({
        ...scope,
        commentId: randomUUID(),
        expectedVersion: 1,
        body,
      }).success,
    ).toBe(false);
  }
});
