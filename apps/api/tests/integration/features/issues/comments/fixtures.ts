import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { IssueComment } from "@kithwork/contracts";
import { useIssueFixture } from "../fixtures.js";
import type { Actor } from "../../organisations/fixtures.js";

export function useCommentFixture() {
  const issues = useIssueFixture();
  const { f } = issues;
  const query = (path: string, input: unknown, actor?: Actor) =>
    f.query(`organisations.issues.comments.${path}`, input, actor);
  const mutate = (path: string, input: unknown, actor?: Actor) =>
    f.mutate(`organisations.issues.comments.${path}`, input, actor);
  async function create(
    scope: { organisationId: string; issueId: string },
    body = "Comment body",
    actor = f.alice,
    creationKey: string = randomUUID(),
  ) {
    const response = await mutate(
      "create",
      { ...scope, body, creationKey },
      actor,
    );
    expect(
      response.statusCode,
      [response.body, ...f.logLines.slice(-3)].join("\n"),
    ).toBe(200);
    return f.data<IssueComment>(response);
  }
  return { f, issues, teams: issues.teams, query, mutate, create };
}
