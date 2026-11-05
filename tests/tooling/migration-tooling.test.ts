import { createTemporaryDirectory } from "../temporary-directory.js";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const exec = promisify(execFile);
it("generates the application schema using shared compiled ESM contracts", async () => {
  const directory = await createTemporaryDirectory("kithwork-app-kit-");
  try {
    const { fileURLToPath } = await import("node:url");
    const config = join(directory, "drizzle.config.json");
    await writeFile(
      config,
      JSON.stringify({
        dialect: "postgresql",
        schema: fileURLToPath(
          new URL("../../packages/database/src/schema.ts", import.meta.url),
        ).replaceAll("\\", "/"),
        out: join(directory, "migrations"),
      }),
    );
    const cli = fileURLToPath(
      new URL("../../node_modules/drizzle-kit/bin.cjs", import.meta.url),
    );
    const generated = await exec(
      process.execPath,
      [cli, "generate", `--config=${config}`, "--name=application"],
      { timeout: 30_000, cwd: directory },
    ).catch((error: unknown) => {
      if (error instanceof Error && "stdout" in error)
        throw new Error(String(error.stdout), { cause: error });
      throw error;
    });
    expect(generated.stderr).toBe("");
    const sql = await readFile(
      join(directory, "migrations/0000_application.sql"),
      "utf8",
    );
    expect(sql).toContain('CREATE TABLE "organisation_member"');
    expect(sql).toContain('CREATE TABLE "auth_user"');
    expect(sql).toContain("'owner', 'admin', 'member'");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it("generates and checks real PostgreSQL SQL using the pinned migration tool", async () => {
  const directory = await createTemporaryDirectory("kithwork-kit-");
  try {
    const schema = join(directory, "schema.ts");
    const output = join(directory, "migrations");
    const config = join(directory, "drizzle.config.json");
    // Resolve the installed ORM from this project rather than the temporary folder.
    const pgCore = createRequire(
      new URL("../../packages/database/package.json", import.meta.url),
    ).resolve("drizzle-orm/pg-core");
    await writeFile(
      schema,
      `import { pgTable, text } from ${JSON.stringify(pgCore)};\nexport const probe = pgTable("kit_probe", { value: text().notNull() });\n`,
    );
    await writeFile(
      config,
      JSON.stringify({
        dialect: "postgresql",
        schema: "./schema.ts",
        out: "./migrations",
      }),
    );
    const cli = new URL(
      "../../node_modules/drizzle-kit/bin.cjs",
      import.meta.url,
    );
    const { fileURLToPath } = await import("node:url");
    const generated = await exec(
      process.execPath,
      [fileURLToPath(cli), "generate", `--config=${config}`, "--name=probe"],
      { timeout: 30_000, cwd: directory },
    ).catch((error: unknown) => {
      if (error instanceof Error && "stdout" in error)
        throw new Error(String(error.stdout), { cause: error });
      throw error;
    });
    expect(generated.stderr).toBe("");
    expect(await readFile(join(output, "0000_probe.sql"), "utf8")).toContain(
      'CREATE TABLE "kit_probe"',
    );
    const checked = await exec(
      process.execPath,
      [fileURLToPath(cli), "check", `--config=${config}`],
      { timeout: 30_000, cwd: directory },
    );
    expect(checked.stderr).toBe("");
    expect(checked.stdout).toContain("Everything's fine");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
