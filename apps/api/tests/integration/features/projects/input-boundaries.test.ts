import { expect, it } from "vitest";
import { useProjectFixture, type Project } from "./fixtures.js";
const { f, teams, mutate, query } = useProjectFixture();

it("accepts uppercase team UUIDs and treats mixed-case duplicates as one identity", async () => {
  const org = await f.create();
  const first = await teams.create(org),
    second = await teams.create(org, { key: "WEB" });
  const input = {
    organisationId: org.id,
    name: "Uppercase launch",
    teamIds: [first.id.toUpperCase()],
  };
  const response = await mutate("create", input, f.alice);
  expect(response.statusCode, response.body).toBe(200);
  const row = f.data<Project>(response);
  expect(row.teams.map((t) => t.id)).toEqual([first.id]);
  const unchanged = await mutate(
    "setTeams",
    {
      organisationId: org.id,
      projectId: row.id,
      expectedVersion: 1,
      teamIds: [first.id.toUpperCase()],
    },
    f.alice,
  );
  expect(unchanged.statusCode, unchanged.body).toBe(200);
  expect(f.data<Project>(unchanged).version).toBe(1);
  const duplicate = await mutate(
    "create",
    { ...input, teamIds: [first.id, first.id.toUpperCase()] },
    f.alice,
  );
  expect(duplicate.statusCode).toBe(400);
  const changed = await mutate(
    "setTeams",
    {
      organisationId: org.id,
      projectId: row.id,
      expectedVersion: 1,
      teamIds: [second.id.toUpperCase()],
    },
    f.alice,
  );
  expect(changed.statusCode, changed.body).toBe(200);
  expect(f.data<Project>(changed).teams.map((t) => t.id)).toEqual([second.id]);
});

it("rejects unstorable year zero at the HTTP boundary without persisting any change", async () => {
  const org = await f.create();
  const team = await teams.create(org);
  const input = {
    organisationId: org.id,
    name: "Calendar launch",
    teamIds: [team.id],
  };
  const invalid = await mutate(
    "create",
    { ...input, startDate: "0000-01-01" },
    f.alice,
  );
  expect(invalid.statusCode, invalid.body).toBe(400);
  expect(
    (
      await f.database.pool.query(
        "SELECT id FROM project WHERE organisation_id=$1",
        [org.id],
      )
    ).rowCount,
  ).toBe(0);
  const valid = await mutate("create", input, f.alice);
  expect(valid.statusCode, valid.body).toBe(200);
  const row = f.data<Project>(valid);
  const update = await mutate(
    "update",
    {
      organisationId: org.id,
      projectId: row.id,
      expectedVersion: 1,
      targetDate: "0000-12-31",
    },
    f.alice,
  );
  expect(update.statusCode, update.body).toBe(400);
  expect(
    f.data<Project>(
      await query(
        "get",
        { organisationId: org.id, projectId: row.id },
        f.alice,
      ),
    ),
  ).toMatchObject({ version: 1, targetDate: null });
});
