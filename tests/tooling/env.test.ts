import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initializeEnvironment } from "../../scripts/env-init.js";

it("initializes local configuration without overwriting an existing environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kithwork-env-"));
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
