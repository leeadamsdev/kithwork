import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { createLogger } from "../../src/logger.js";

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
