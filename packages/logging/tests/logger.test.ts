import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { createLogger } from "../src/index.js";

it("redacts password-reset tokens embedded in request paths", () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const log = createLogger("info", stream);
  log.info(
    {
      req: {
        id: "request-id",
        method: "GET",
        url: "/api/auth/reset-password/private-reset-token?callbackURL=private-redirect",
      },
    },
    "Request completed",
  );
  expect(lines[0]).not.toContain("private-reset-token");
  expect(lines[0]).not.toContain("private-redirect");
  expect(JSON.parse(lines[0]!)).toMatchObject({
    req: { path: "/api/auth/reset-password/[Redacted]" },
  });
});

it("logs request identity without URL queries, headers, bodies or credentials", () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const log = createLogger("info", stream);
  log.info(
    {
      req: {
        id: "request-id",
        method: "GET",
        url: "/trpc/system.info?input=private",
        headers: { authorization: "secret" },
        body: "private",
      },
      password: "secret",
      token: "secret",
      databaseUrl: "secret",
    },
    "request",
  );
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    req: { id: "request-id", method: "GET", path: "/trpc/system.info" },
  });
  expect(lines[0]).not.toMatch(/private|secret|authorization/);
});

it("redacts Redis authentication arguments carried by error objects", () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const log = createLogger("error", stream);
  const error = Object.assign(
    new Error("WRONGPASS invalid username-password pair"),
    {
      command: {
        name: "hello",
        args: ["3", "AUTH", "default", "private-redis-password"],
      },
    },
  );
  log.error({ err: error }, "Redis connection error");
  expect(lines[0]).not.toContain("private-redis-password");
  expect(lines[0]).toContain("WRONGPASS");
});
