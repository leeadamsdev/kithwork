import { afterAll, beforeAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { createLogger } from "@kithwork/logging";
import { createApi } from "../../../../src/app.js";
import { parseConfig } from "../../../../src/config.js";
import { apiTestEnvironment } from "../../../fixtures/config.js";
import { createTestDatabase } from "../../../../../../tests/integration/platform/database/fixtures.js";
import { uniqueNamespace } from "../../../../../../tests/integration/support/namespace.js";
import { integrationServices } from "../../../../../../tests/integration/context.js";
export type Actor = { id: string; cookie: string; email: string };
export type Org = { id: string; name: string; role: string };
export type Member = {
  userId: string;
  name: string;
  role: string;
  joinedAt: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export function useOrganisationFixture() {
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
      API_INVITATION_SEND_RATE_LIMIT_MAX: "100",
      API_INVITATION_ACCESS_RATE_LIMIT_MAX: "100",
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
    return { id, cookie, email };
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
  return {
    get database() {
      return database;
    },
    get app() {
      return app;
    },
    get alice() {
      return alice;
    },
    get bob() {
      return bob;
    },
    get carol() {
      return carol;
    },
    webOrigin,
    logLines,
    config,
    query,
    mutate,
    data,
    person,
    create,
    member,
  };
}
