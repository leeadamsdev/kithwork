import { createTemporaryDirectory } from "../../../temporary-directory.js";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { migrateDatabase } from "@kithwork/database/migrate";
import { databaseFixture } from "./fixtures.js";

const exec = promisify(execFile);
const fixture = databaseFixture();
it("applies generated SQL, preserves data on upgrade, and does not reapply migrations", async () => {
  const directory = await createTemporaryDirectory("kithwork-kit-pg-");
  const database = fixture();
  const kit = fileURLToPath(
    new URL("../../../../node_modules/drizzle-kit/bin.cjs", import.meta.url),
  );
  const pgCore = createRequire(
    new URL("../../../../packages/database/package.json", import.meta.url),
  ).resolve("drizzle-orm/pg-core");
  const schema = join(directory, "schema.ts");
  const config = join(directory, "drizzle.config.json");
  const folder = join(directory, "migrations");
  const migrate = () =>
    migrateDatabase({
      connectionString: database.connectionString,
      onPoolError: database.onPoolError,
      migrationsFolder: folder,
    });
  try {
    await writeFile(
      config,
      JSON.stringify({
        dialect: "postgresql",
        schema: "./schema.ts",
        out: "./migrations",
      }),
    );
    await writeFile(
      schema,
      `import { pgTable, text } from ${JSON.stringify(pgCore)};\nexport const probe = pgTable("generated_probe", { value: text().notNull() });\n`,
    );
    await exec(
      process.execPath,
      [kit, "generate", `--config=${config}`, "--name=initial"],
      { cwd: directory, timeout: 30000 },
    );
    expect(await readFile(join(folder, "0000_initial.sql"), "utf8")).toContain(
      'CREATE TABLE "generated_probe"',
    );
    await migrate();
    await database.pool.query(
      "INSERT INTO generated_probe(value) VALUES ($1)",
      ["preserved"],
    );
    await writeFile(
      schema,
      `import { pgTable, text } from ${JSON.stringify(pgCore)};\nexport const probe = pgTable("generated_probe", { value: text().notNull(), note: text() });\n`,
    );
    await exec(
      process.execPath,
      [kit, "generate", `--config=${config}`, "--name=note"],
      { cwd: directory, timeout: 30000 },
    );
    await migrate();
    await migrate();
    expect(
      (await database.pool.query("SELECT value, note FROM generated_probe"))
        .rows,
    ).toEqual([{ value: "preserved", note: null }]);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
        )
      ).rows,
    ).toEqual([{ count: 2 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it("runs the compiled migration command with the committed application journal", async () => {
  const cli = fileURLToPath(
    new URL(
      "../../../../packages/database/dist/migrations/cli.js",
      import.meta.url,
    ),
  );
  const result = await exec(process.execPath, [cli], {
    env: { ...process.env, DATABASE_URL: fixture().connectionString },
    timeout: 10000,
  });
  expect(result.stdout).toContain("Database migrations applied");
  expect(result.stderr).toBe("");
});
