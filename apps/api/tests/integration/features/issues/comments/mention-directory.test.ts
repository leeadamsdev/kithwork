import { expect, it, vi } from "vitest";
import * as access from "../../../../../src/features/teams/access.js";
import { useCommentFixture } from "./fixtures.js";
const { f, teams } = useCommentFixture();
type Page = {
  items: { id: string; name: string }[];
  nextCursor: string | null;
};
const list = async (input: unknown, actor = f.alice) => {
  const r = await f.query(
    "organisations.issues.comments.mentionTargets",
    input,
    actor,
  );
  expect(r.statusCode, r.body).toBe(200);
  return f.data<Page>(r);
};

it("selects only eligible ID/name targets with literal case-insensitive prefixes and bounded cursor pages", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org),
    scope = { organisationId: org.id, teamId: team.id };
  await f.database.pool.query(
    "UPDATE auth_user SET name='Al_bert' WHERE id=$1",
    [f.bob.id],
  );
  await f.database.pool.query(
    "UPDATE auth_user SET name='Al%bert' WHERE id=$1",
    [f.carol.id],
  );
  const all = await list({ ...scope, prefix: "  AL  " });
  expect(all.items.map((r) => r.id)).toEqual(
    [f.alice.id, f.bob.id, f.carol.id].sort(),
  );
  expect(JSON.stringify(all)).not.toContain(f.alice.email);
  expect(
    (await list({ ...scope, prefix: "al_" })).items.map((r) => r.id),
  ).toEqual([f.bob.id]);
  expect(
    (await list({ ...scope, prefix: "al%" })).items.map((r) => r.id),
  ).toEqual([f.carol.id]);
  await f.database.pool.query("UPDATE auth_user SET name=$1 WHERE id=$2", [
    "Al\\bert",
    f.bob.id,
  ]);
  expect(
    (await list({ ...scope, prefix: "al\\" })).items.map((r) => r.id),
  ).toEqual([f.bob.id]);
  const first = await list({ ...scope, limit: 1 });
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  const next = await list({ ...scope, cursor: first.nextCursor, limit: 10 });
  expect([...first.items, ...next.items].map((r) => r.id)).toEqual(
    all.items.map((r) => r.id),
  );
  expect(next.nextCursor).toBeNull();
});

it("rechecks caller and target visibility in directory SQL after the access precheck", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  await f.member(org, f.carol);
  const team = await teams.create(org, { visibility: "private" }),
    scope = { organisationId: org.id, teamId: team.id };
  expect(
    (
      await f.query(
        "organisations.issues.comments.mentionTargets",
        scope,
        f.bob,
      )
    ).statusCode,
  ).toBe(404);
  for (const actor of [f.bob, f.carol]) {
    const r = await teams.mutate(
      "members.add",
      { ...scope, userId: actor.id },
      f.alice,
    );
    expect(r.statusCode, r.body).toBe(200);
  }
  const original = access.readTeamAccess;
  try {
    vi.spyOn(access, "readTeamAccess").mockImplementationOnce(
      async (...args) => {
        const row = await original(...args);
        await f.database.pool.query(
          "DELETE FROM team_member WHERE team_id=$1 AND user_id=$2",
          [team.id, f.carol.id],
        );
        return row;
      },
    );
    expect((await list(scope, f.bob)).items.map((r) => r.id)).toEqual(
      [f.alice.id, f.bob.id].sort(),
    );
    vi.spyOn(access, "readTeamAccess").mockImplementationOnce(
      async (...args) => {
        const row = await original(...args);
        await f.database.pool.query(
          "DELETE FROM team_member WHERE team_id=$1 AND user_id=$2",
          [team.id, f.bob.id],
        );
        return row;
      },
    );
    expect((await list(scope, f.bob)).items).toEqual([]);
  } finally {
    vi.restoreAllMocks();
  }
});
