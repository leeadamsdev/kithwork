import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../src/app.js";
import { parseConfig } from "../../src/config.js";
import { apiTestEnvironment } from "../fixtures/config.js";
import {
  createTestDatabase,
  uniqueNamespace,
} from "../../../../tests/integration/fixtures.js";
import { integrationServices } from "../../../../tests/integration/context.js";

type Actor = { id: string; cookie: string };
type Org = { id: string; name: string; role: string };
type Member = { userId: string; name: string; role: string; joinedAt: string };
type Page<T> = { items: T[]; nextCursor: string | null };

describe("organisation access", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApi>;
  let alice: Actor;
  let bob: Actor;
  let carol: Actor;
  const webOrigin = "https://app.kithwork.test";
  const logLines: string[] = [];
  const config = (overrides: Record<string, string> = {}) =>
    parseConfig({
      ...apiTestEnvironment,
      DATABASE_URL: database.connectionString,
      REDIS_URL: integrationServices().redisUrl,
      AUTH_BASE_URL: "https://api.kithwork.test",
      WEB_ORIGIN: webOrigin,
      EMAIL_QUEUE_PREFIX: uniqueNamespace(),
      API_RATE_LIMIT_NAMESPACE: uniqueNamespace(),
      API_AUTH_RATE_LIMIT_MAX: "100",
      API_ORGANISATION_CREATION_RATE_LIMIT_MAX: "100",
      ...overrides,
    });
  beforeAll(async () => {
    database = await createTestDatabase({ migrate: true });
    app = createApi({
      config: config(),
      logger: createLogger(
        "info",
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            logLines.push(chunk.toString());
            done();
          },
        }),
      ),
    });
    await app.ready();
    alice = await person("Alice");
    bob = await person("Bob");
    carol = await person("Carol");
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
  });
  const query = (path: string, input: unknown, actor?: Actor, instance = app) =>
    instance.inject({
      url: `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
      headers: actor ? { cookie: actor.cookie } : {},
    });
  const mutate = (
    path: string,
    input: unknown,
    actor?: Actor,
    instance = app,
  ) =>
    instance.inject({
      method: "POST",
      url: `/trpc/${path}`,
      payload: input as Record<string, unknown>,
      headers: {
        origin: webOrigin,
        ...(actor ? { cookie: actor.cookie } : {}),
      },
    });
  const data = <T>(response: Awaited<ReturnType<typeof query>>) =>
    response.json<{ result: { data: T } }>().result.data;
  async function person(name: string): Promise<Actor> {
    const email = `${randomUUID()}@example.test`;
    const password = "organisation-test-password-12345";
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: webOrigin },
      payload: { name, email, password },
    });
    expect(signup.statusCode, signup.body).toBe(200);
    const id = signup.json<{ user: { id: string } }>().user.id;
    await database.pool.query(
      "UPDATE auth_user SET email_verified=true WHERE id=$1",
      [id],
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: webOrigin },
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const raw = login.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw : [raw!])
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    return { id, cookie };
  }
  async function create(actor = alice, name = "Engineering", instance = app) {
    const response = await mutate(
      "organisations.create",
      { name },
      actor,
      instance,
    );
    expect(response.statusCode, response.body).toBe(200);
    return data<Org>(response);
  }
  async function member(org: Org, actor: Actor, role = "member") {
    await database.pool.query(
      "INSERT INTO organisation_member(organisation_id,user_id,role) VALUES($1,$2,$3)",
      [org.id, actor.id, role],
    );
  }

  it("requires verified identity and atomically creates the first owner", async () => {
    expect(
      (await mutate("organisations.create", { name: "Team" })).statusCode,
    ).toBe(401);
    expect(
      data<Page<Org>>(await query("organisations.list", {}, alice)).items,
    ).toEqual([]);
    const org = await create(alice, "  Engineering 工程  ");
    expect(org).toMatchObject({ name: "Engineering 工程", role: "owner" });
    expect(
      (
        await database.pool.query(
          "SELECT user_id,role FROM organisation_member WHERE organisation_id=$1",
          [org.id],
        )
      ).rows,
    ).toEqual([{ user_id: alice.id, role: "owner" }]);
    expect(
      (await query("organisations.get", { organisationId: org.id }, alice))
        .headers["cache-control"],
    ).toBe("no-store");
  });
  it("isolates tenants and reads current membership for each organisation", async () => {
    const a = await create(alice);
    const b = await create(bob);
    await member(b, alice, "admin");
    expect(
      data<Org>(
        await query("organisations.get", { organisationId: a.id }, alice),
      ).role,
    ).toBe("owner");
    expect(
      data<Org>(
        await query("organisations.get", { organisationId: b.id }, alice),
      ).role,
    ).toBe("admin");
    for (const id of [a.id, randomUUID()])
      expect(
        (await query("organisations.get", { organisationId: id }, carol))
          .statusCode,
      ).toBe(404);
    expect(
      (await query("organisations.members.list", { organisationId: a.id }, bob))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await mutate(
          "organisations.update",
          { organisationId: a.id, name: "Stolen" },
          bob,
        )
      ).statusCode,
    ).toBe(404);
  });
  it("enforces the administration policy and revokes only the removed membership", async () => {
    const org = await create();
    await member(org, bob, "admin");
    await member(org, carol);
    expect(
      (
        await mutate(
          "organisations.update",
          { organisationId: org.id, name: "Member rename" },
          carol,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await mutate(
          "organisations.update",
          { organisationId: org.id, name: "Admin rename" },
          bob,
        )
      ).statusCode,
    ).toBe(200);
    for (const userId of [bob.id, carol.id])
      expect(
        (
          await mutate(
            "organisations.members.changeRole",
            { organisationId: org.id, userId, role: "owner" },
            bob,
          )
        ).statusCode,
      ).toBe(403);
    for (const userId of [alice.id, bob.id])
      expect(
        (
          await mutate(
            "organisations.members.remove",
            { organisationId: org.id, userId },
            bob,
          )
        ).statusCode,
      ).toBe(403);
    const other = await create(carol);
    expect(
      (
        await mutate(
          "organisations.members.remove",
          { organisationId: org.id, userId: carol.id },
          bob,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await query("organisations.get", { organisationId: org.id }, carol))
        .statusCode,
    ).toBe(404);
    expect(
      (await query("organisations.get", { organisationId: other.id }, carol))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/trpc/auth.me",
          headers: { cookie: carol.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("scopes membership targets and rejects actor or role injection", async () => {
    const a = await create();
    const b = await create(bob);
    await member(b, carol);
    for (const path of [
      "organisations.members.changeRole",
      "organisations.members.remove",
    ]) {
      const input = {
        organisationId: a.id,
        userId: carol.id,
        ...(path.endsWith("changeRole") ? { role: "owner" } : {}),
      };
      expect((await mutate(path, input, alice)).statusCode).toBe(404);
    }
    expect(
      (
        await mutate(
          "organisations.create",
          { name: "Spoofed", role: "owner", userId: bob.id },
          alice,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await mutate(
          "organisations.update",
          { organisationId: a.id, name: "Spoofed", actorId: bob.id },
          alice,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      data<Org>(
        await query("organisations.get", { organisationId: b.id }, carol),
      ).role,
    ).toBe("member");
  });
  it("keeps independently authorised organisation contexts in a mixed batch", async () => {
    const a = await create();
    const b = await create(bob);
    const c = await create(carol);
    await member(b, alice, "admin");
    const response = await app.inject({
      url: `/trpc/organisations.get,organisations.get,organisations.get?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { organisationId: a.id }, 1: { organisationId: b.id }, 2: { organisationId: c.id } }))}`,
      headers: { cookie: alice.cookie },
    });
    expect(response.statusCode).toBe(207);
    const result =
      response.json<
        [
          { result: { data: Org } },
          { result: { data: Org } },
          { error: { data: { httpStatus: number } } },
        ]
      >();
    expect(result[0].result.data).toMatchObject({ id: a.id, role: "owner" });
    expect(result[1].result.data).toMatchObject({ id: b.id, role: "admin" });
    expect(result[2].error.data.httpStatus).toBe(404);
  });
  it("paginates a safe member directory and only lists the caller's organisations", async () => {
    const org = await create();
    await member(org, bob);
    await member(org, carol);
    const seen: Member[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const response = await query(
        "organisations.members.list",
        { organisationId: org.id, limit: 1, ...(cursor ? { cursor } : {}) },
        alice,
      );
      expect(response.statusCode).toBe(200);
      const value = data<Page<Member>>(response);
      expect(value.items).toHaveLength(1);
      seen.push(...value.items);
      expect(response.body).not.toMatch(/email|password|token/);
      expect(Object.keys(value.items[0]!).sort()).toEqual([
        "joinedAt",
        "name",
        "role",
        "userId",
      ]);
      cursor = value.nextCursor ?? undefined;
    }
    expect(cursor).toBeUndefined();
    expect(new Set(seen.map((item) => item.userId)).size).toBe(3);
    const listed = new Set<string>();
    let orgCursor: string | undefined;
    do {
      const response = data<Page<Org>>(
        await query(
          "organisations.list",
          { limit: 2, ...(orgCursor ? { cursor: orgCursor } : {}) },
          alice,
        ),
      );
      expect(response.items.length).toBeLessThanOrEqual(2);
      for (const value of response.items) {
        expect(listed.has(value.id)).toBe(false);
        listed.add(value.id);
      }
      orgCursor = response.nextCursor ?? undefined;
    } while (orgCursor);
    const actual = await database.pool.query<{ organisation_id: string }>(
      "SELECT organisation_id FROM organisation_member WHERE user_id=$1",
      [alice.id],
    );
    expect([...listed].sort()).toEqual(
      actual.rows.map((row) => row.organisation_id).sort(),
    );
    expect(
      (
        await query(
          "organisations.members.list",
          { organisationId: org.id, limit: 101 },
          alice,
        )
      ).statusCode,
    ).toBe(400);
  });
  it("preserves an owner under leave, removal and role-change attempts", async () => {
    const org = await create();
    expect(
      (await mutate("organisations.leave", { organisationId: org.id }, alice))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await mutate(
          "organisations.members.remove",
          { organisationId: org.id, userId: alice.id },
          alice,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await mutate(
          "organisations.members.changeRole",
          { organisationId: org.id, userId: alice.id, role: "admin" },
          alice,
        )
      ).statusCode,
    ).toBe(409);
    await member(org, bob);
    expect(
      (
        await mutate(
          "organisations.members.changeRole",
          { organisationId: org.id, userId: bob.id, role: "owner" },
          alice,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await mutate("organisations.leave", { organisationId: org.id }, alice))
        .statusCode,
    ).toBe(200);
    expect(
      (await query("organisations.get", { organisationId: org.id }, alice))
        .statusCode,
    ).toBe(404);
    expect(
      data<Org>(
        await query("organisations.get", { organisationId: org.id }, bob),
      ).role,
    ).toBe("owner");
  });
  it("rejects untrusted or missing origins and non-JSON mutation bodies before writing", async () => {
    for (const origin of [
      undefined,
      "null",
      "https://attacker.test",
      `${webOrigin}.attacker.test`,
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/trpc/organisations.create",
        headers: {
          cookie: alice.cookie,
          ...(origin ? { origin } : {}),
          host: "attacker.test",
          "x-forwarded-host": "app.kithwork.test",
        },
        payload: { name: "Forbidden origin" },
      });
      expect(response.statusCode).toBe(403);
    }
    const plain = await app.inject({
      method: "POST",
      url: "/trpc/organisations.create",
      headers: {
        cookie: alice.cookie,
        origin: webOrigin,
        "content-type": "text/plain",
      },
      payload: '{"name":"Plain text"}',
    });
    expect(plain.statusCode).toBe(415);
    expect(
      (
        await database.pool.query(
          "SELECT id FROM organisation WHERE name IN ('Forbidden origin','Plain text')",
        )
      ).rows,
    ).toEqual([]);
    const ownOrigin = await app.inject({
      method: "POST",
      url: "/trpc/organisations.create",
      headers: {
        cookie: alice.cookie,
        origin: "https://api.kithwork.test",
        "content-type": "application/json; charset=utf-8",
      },
      payload: JSON.stringify({ name: "API origin" }),
    });
    expect(ownOrigin.statusCode).toBe(200);
  });
  it("retains an owner when owners concurrently leave or demote themselves", async () => {
    for (const mode of ["leave", "demote"]) {
      const org = await create();
      await member(org, bob, "owner");
      const results = await Promise.all(
        [alice, bob].map((actor) =>
          mode === "leave"
            ? mutate("organisations.leave", { organisationId: org.id }, actor)
            : mutate(
                "organisations.members.changeRole",
                { organisationId: org.id, userId: actor.id, role: "admin" },
                actor,
              ),
        ),
      );
      expect(results.map((result) => result.statusCode).sort()).toEqual([
        200, 409,
      ]);
      expect(
        (
          await database.pool.query(
            "SELECT user_id FROM organisation_member WHERE organisation_id=$1 AND role='owner'",
            [org.id],
          )
        ).rows,
      ).toHaveLength(1);
    }
  });
  it("rechecks a waiting administrator's permissions after acquiring the organisation lock", async () => {
    const org = await create();
    await member(org, bob, "admin");
    const blocker = await database.pool.connect();
    let committed = false;
    let pending: ReturnType<typeof mutate> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
        [org.id],
      );
      pending = mutate(
        "organisations.update",
        { organisationId: org.id, name: "Stale admin write" },
        bob,
      );
      await expect
        .poll(
          async () =>
            (
              await database.pool.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%from \"organisation\"%'",
              )
            ).rows[0]!.count,
          { timeout: 1500, interval: 10 },
        )
        .toBe(1);
      await blocker.query(
        "UPDATE organisation_member SET role='member' WHERE organisation_id=$1 AND user_id=$2",
        [org.id, bob.id],
      );
      await blocker.query("COMMIT");
      committed = true;
      expect((await pending).statusCode).toBe(403);
      expect(
        data<Org>(
          await query("organisations.get", { organisationId: org.id }, alice),
        ).name,
      ).toBe("Engineering");
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });
  it("bounds lock waits and reports a safe retryable conflict", async () => {
    const org = await create();
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM organisation WHERE id=$1 FOR UPDATE",
        [org.id],
      );
      const response = await mutate(
        "organisations.update",
        { organisationId: org.id, name: "Blocked" },
        alice,
      );
      expect(response.statusCode).toBe(409);
      expect(response.body).not.toMatch(/select|parameters|lock_timeout/);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("rolls back an organisation when owner insertion fails and keeps database details private", async () => {
    const marker = "private-organisation-database-marker";
    const logStart = logLines.length;
    await database.pool.query(
      `CREATE FUNCTION fail_org_membership() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION '${marker}'; END;$$; CREATE TRIGGER fail_org_membership BEFORE INSERT ON organisation_member FOR EACH ROW EXECUTE FUNCTION fail_org_membership()`,
    );
    try {
      const response = await mutate(
        "organisations.create",
        { name: "Rolled back organisation" },
        alice,
      );
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(marker);
      expect(
        (
          await database.pool.query(
            "SELECT id FROM organisation WHERE name='Rolled back organisation'",
          )
        ).rows,
      ).toEqual([]);
      const logs = logLines.slice(logStart).join("");
      expect(logs).toContain(response.headers["x-request-id"]);
      expect(logs).not.toContain(marker);
      expect(logs).not.toContain("insert into");
    } finally {
      await database.pool.query(
        "DROP TRIGGER fail_org_membership ON organisation_member; DROP FUNCTION fail_org_membership()",
      );
    }
  });
  it("requires the organisation migration before announcing readiness", async () => {
    await database.pool.query(
      "ALTER TABLE organisation RENAME TO unavailable_organisation",
    );
    const instance = createApi({
      config: config(),
      logger: createLogger("silent"),
    });
    try {
      await expect(instance.ready()).rejects.toMatchObject({ code: "42P01" });
    } finally {
      await instance.close();
      await database.pool.query(
        "ALTER TABLE unavailable_organisation RENAME TO organisation",
      );
    }
  });
  it("counts each batched creation per user across API instances without sharing other users' buckets", async () => {
    const options = config({ API_ORGANISATION_CREATION_RATE_LIMIT_MAX: "2" });
    const first = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    const second = createApi({
      config: options,
      logger: createLogger("silent"),
    });
    try {
      await Promise.all([first.ready(), second.ready()]);
      await create(alice, "First limited creation", first);
      const response = await second.inject({
        method: "POST",
        url: "/trpc/organisations.create,organisations.create?batch=1",
        headers: { cookie: alice.cookie, origin: webOrigin },
        payload: {
          0: { name: "Second limited creation" },
          1: { name: "Third limited creation" },
        },
      });
      expect(response.statusCode).toBe(207);
      const items =
        response.json<
          { error?: { data: { httpStatus: number } }; result?: unknown }[]
        >();
      expect(items.filter((item) => item.result)).toHaveLength(1);
      expect(items.find((item) => item.error)?.error?.data.httpStatus).toBe(
        429,
      );
      expect(
        (
          await mutate(
            "organisations.create",
            { name: "Fourth limited creation" },
            alice,
            first,
          )
        ).statusCode,
      ).toBe(429);
      await create(bob, "Independent user", second);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
