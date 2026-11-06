import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { IssueComment } from "@kithwork/contracts";
import * as events from "../../../../../src/features/issues/comments/events.js";
import { useCommentFixture } from "./fixtures.js";
const { f, teams, issues, create, mutate } = useCommentFixture();

async function waitForLock(table: string) {
  await expect
    .poll(
      async () =>
        (
          await f.database.pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
            [`%from "${table}"%`],
          )
        ).rows[0]!.count,
      { timeout: 1500, interval: 10 },
    )
    .toBe(1);
}

it("serializes duplicate creates and stale edits without advancing the issue version", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const key = randomUUID();
  const rows = await Promise.all([
    create(scope, "Concurrent", f.alice, key),
    create(scope, "Concurrent", f.alice, key.toUpperCase()),
  ]);
  expect(rows[0].id).toBe(rows[1].id);
  const edits = await Promise.all(
    ["First", "Second"].map((body) =>
      mutate(
        "update",
        { ...scope, commentId: rows[0].id, expectedVersion: 1, body },
        f.alice,
      ),
    ),
  );
  expect(edits.map((row) => row.statusCode).sort()).toEqual([200, 409]);
  expect(
    (
      await f.database.pool.query(
        "SELECT count(*)::int AS count FROM issue_comment_event WHERE comment_id=$1",
        [rows[0].id],
      )
    ).rows,
  ).toEqual([{ count: 2 }]);
  expect((await issues.get(scope)).version).toBe(1);
});

it("blocks archive behind a comment transaction while another issue remains editable", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    other = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const release = Promise.withResolvers<void>();
  let entered = false;
  const original = events.appendCommentEvent;
  const gate = vi
    .spyOn(events, "appendCommentEvent")
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      entered = true;
      await release.promise;
    });
  const posting = create(scope, "Before archive");
  let archive: ReturnType<typeof issues.mutate> | undefined;
  try {
    await expect.poll(() => entered).toBe(true);
    archive = issues.mutate(
      "archive",
      { ...scope, expectedVersion: 1 },
      f.alice,
    );
    await waitForLock("issue");
    expect(
      (
        await issues.mutate(
          "update",
          {
            organisationId: org.id,
            issueId: other.id,
            expectedVersion: 1,
            title: "Independent",
          },
          f.alice,
        )
      ).statusCode,
    ).toBe(200);
    release.resolve();
    await posting;
    const response = await archive;
    expect(response.statusCode, response.body).toBe(200);
    expect(
      (
        await mutate(
          "create",
          { ...scope, creationKey: randomUUID(), body: "After archive" },
          f.alice,
        )
      ).statusCode,
    ).toBe(409);
  } finally {
    release.resolve();
    await posting;
    await archive;
    gate.mockRestore();
  }
});

it("rechecks lifecycle after waiting behind an archive that passed the preliminary read", async () => {
  const org = await f.create(),
    team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const blocker = await f.database.pool.connect();
  let pending: ReturnType<typeof mutate> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM issue WHERE id=$1 FOR UPDATE", [
      issue.id,
    ]);
    pending = mutate(
      "create",
      { ...scope, creationKey: randomUUID(), body: "Too late" },
      f.alice,
    );
    await waitForLock("issue");
    await blocker.query(
      "UPDATE issue SET archived_at=clock_timestamp(),version=version+1 WHERE id=$1",
      [issue.id],
    );
    await blocker.query("COMMIT");
    const response = await pending;
    expect(response.statusCode, response.body).toBe(409);
    expect(
      (
        await f.database.pool.query(
          "SELECT count(*)::int AS count FROM issue_comment WHERE issue_id=$1",
          [issue.id],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  } finally {
    await blocker.query("ROLLBACK");
    await pending;
    blocker.release();
  }
});

it("rechecks manager authority after waiting behind organisation demotion", async () => {
  const org = await f.create();
  await f.member(org, f.carol, "admin");
  const team = await teams.create(org),
    issue = await issues.create({ organisationId: org.id, teamId: team.id }),
    scope = { organisationId: org.id, issueId: issue.id };
  const comment = await create(scope, "Keep this");
  const blocker = await f.database.pool.connect();
  let pending: ReturnType<typeof mutate> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM organisation WHERE id=$1 FOR UPDATE", [
      org.id,
    ]);
    pending = mutate(
      "delete",
      { ...scope, commentId: comment.id, expectedVersion: 1 },
      f.carol,
    );
    await waitForLock("organisation");
    await blocker.query(
      "UPDATE organisation_member SET role='member' WHERE organisation_id=$1 AND user_id=$2",
      [org.id, f.carol.id],
    );
    await blocker.query("COMMIT");
    const response = await pending;
    expect(response.statusCode, response.body).toBe(403);
    const read = await f.query(
      "organisations.issues.comments.get",
      { ...scope, commentId: comment.id },
      f.alice,
    );
    expect(f.data<IssueComment>(read).body).toBe("Keep this");
  } finally {
    await blocker.query("ROLLBACK");
    await pending;
    blocker.release();
  }
});
