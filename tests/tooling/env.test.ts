import { createTemporaryDirectory } from "../temporary-directory.js";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initializeEnvironment } from "../../scripts/env-init.js";

it("generates independent authentication and email secrets", async () => {
  const directory = await createTemporaryDirectory("kithwork-auth-env-");
  try {
    const source = join(directory, ".env.example");
    const target = join(directory, ".env");
    await writeFile(source, "AUTH_SECRET=\nMAIL_ENCRYPTION_KEY=\n");
    await initializeEnvironment(source, target);
    const contents = await readFile(target, "utf8");
    const secrets = contents
      .trim()
      .split("\n")
      .map((line) => line.slice(line.indexOf("=") + 1));
    expect(secrets).toHaveLength(2);
    expect(secrets.every((value) => /^[A-Za-z0-9+/]{43}=$/.test(value))).toBe(
      true,
    );
    expect(secrets[0]).not.toBe(secrets[1]);
    expect(await initializeEnvironment(source, target)).toBe(false);
    expect(await readFile(target, "utf8")).toBe(contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("generates a unique local email key and preserves it on repeated setup", async () => {
  const directory = await createTemporaryDirectory("kithwork-env-");
  try {
    const source = join(directory, ".env.example");
    const first = join(directory, "first.env");
    const second = join(directory, "second.env");
    await writeFile(source, "MAIL_ENCRYPTION_KEY=\n");
    await initializeEnvironment(source, first);
    await initializeEnvironment(source, second);
    const value = await readFile(first, "utf8");
    expect(value).toMatch(/^MAIL_ENCRYPTION_KEY=[A-Za-z0-9+/]{43}=\n$/);
    expect(await readFile(second, "utf8")).not.toBe(value);
    expect(await initializeEnvironment(source, first)).toBe(false);
    expect(await readFile(first, "utf8")).toBe(value);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("initializes local configuration without overwriting an existing environment", async () => {
  const directory = await createTemporaryDirectory("kithwork-env-");
  try {
    const source = join(directory, ".env.example");
    const target = join(directory, ".env");
    await writeFile(source, "API_PORT=3001\n");
    expect(await initializeEnvironment(source, target)).toBe(true);
    expect(await readFile(target, "utf8")).toBe("API_PORT=3001\n");
    await writeFile(target, "API_PORT=4000\n");
    expect(await initializeEnvironment(source, target)).toBe(false);
    expect(await readFile(target, "utf8")).toBe("API_PORT=4000\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
