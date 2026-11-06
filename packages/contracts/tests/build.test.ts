import { createTemporaryDirectory } from "../../../tests/temporary-directory.js";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(exec);

it("removes obsolete JavaScript, declarations and maps after a source rename", async () => {
  const fixture = await createTemporaryDirectory("kithwork-build-");

  try {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as { scripts: { build: string } };

    await mkdir(join(fixture, "src"));
    await writeFile(
      join(fixture, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await writeFile(
      join(fixture, "tsconfig.build.json"),
      JSON.stringify({
        extends: join(packageRoot, "tsconfig.build.json"),
        compilerOptions: {
          rootDir: "src",
          outDir: "dist",
          // This fixture checks emitted artifacts; the normal build checks library declarations.
          skipLibCheck: true,
        },
        include: ["src/**/*.ts"],
      }),
    );
    await writeFile(
      join(fixture, "src", "obsolete.ts"),
      "export const value = 1;\n",
    );

    const scripts = join(packageRoot, "scripts");
    if (existsSync(scripts)) {
      await cp(scripts, join(fixture, "scripts"), { recursive: true });
    }

    await execute(manifest.scripts.build, { cwd: fixture });
    expect(await readdir(join(fixture, "dist"))).toContain("obsolete.js");

    await rename(
      join(fixture, "src", "obsolete.ts"),
      join(fixture, "src", "current.ts"),
    );
    await execute(manifest.scripts.build, { cwd: fixture });

    expect((await readdir(join(fixture, "dist"))).sort()).toEqual([
      "current.d.ts",
      "current.d.ts.map",
      "current.js",
      "current.js.map",
    ]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);
