import { expect, it } from "vitest";
import { useProjectFixture, type Project } from "./fixtures.js";
const { f, teams, create, query, mutate } = useProjectFixture();

it("rejects concurrent stale detail and team-set changes without losing either committed state", async () => {
  const org = await f.create();
  const first = await teams.create(org),
    second = await teams.create(org, { key: "WEB" });
  const project = await create(org, [first.id]);
  const input = {
    organisationId: org.id,
    projectId: project.id,
    expectedVersion: 1,
  };
  const results = await Promise.all([
    mutate("update", { ...input, name: "New launch" }, f.alice),
    mutate("setTeams", { ...input, teamIds: [first.id, second.id] }, f.alice),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const saved = f.data<Project>(
    await query(
      "get",
      { organisationId: org.id, projectId: project.id },
      f.alice,
    ),
  );
  expect(saved.version).toBe(2);
  if (results[0].statusCode === 200) {
    expect(saved.name).toBe("New launch");
    expect(saved.teams.map((t) => t.id)).toEqual([first.id]);
  } else {
    expect(saved.name).toBe("Billing launch");
    expect(saved.teams.map((t) => t.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  }
});

it("rechecks team authority after waiting for the organisation lock", async () => {
  const org = await f.create();
  await f.member(org, f.bob);
  const team = await teams.create(org);
  await teams.mutate(
    "members.add",
    {
      organisationId: org.id,
      teamId: team.id,
      userId: f.bob.id,
      role: "maintainer",
    },
    f.alice,
  );
  const project = await create(org, [team.id]);
  const blocker = await f.database.pool.connect();
  let pending: ReturnType<typeof mutate> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM organisation WHERE id=$1 FOR UPDATE", [
      org.id,
    ]);
    pending = mutate(
      "update",
      {
        organisationId: org.id,
        projectId: project.id,
        expectedVersion: 1,
        name: "Unauthorised edit",
      },
      f.bob,
    );
    await expect
      .poll(
        async () =>
          (
            await f.database.pool.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%from \"organisation\"%'",
            )
          ).rows[0]!.count,
        { timeout: 1500, interval: 10 },
      )
      .toBe(1);
    await blocker.query(
      "UPDATE team_member SET role='member' WHERE organisation_id=$1 AND team_id=$2 AND user_id=$3",
      [org.id, team.id, f.bob.id],
    );
    await blocker.query("COMMIT");
    expect((await pending).statusCode).toBe(403);
    expect(
      f.data<Project>(
        await query(
          "get",
          { organisationId: org.id, projectId: project.id },
          f.alice,
        ),
      ),
    ).toMatchObject({ version: 1, name: "Billing launch" });
  } finally {
    await blocker.query("ROLLBACK");
    await pending;
    blocker.release();
  }
});
