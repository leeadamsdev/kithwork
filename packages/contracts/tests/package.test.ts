import { entityIdSchema } from "@kithwork/contracts";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("compiled package", () => {
  it("exposes the identifier contract through its ESM export", () => {
    expect(entityIdSchema.parse("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("can be bundled for a browser without Node.js dependencies", async () => {
    const result = await build({
      stdin: {
        contents: 'export { entityIdSchema } from "@kithwork/contracts";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      },
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2024",
      write: false,
    });

    expect(result.warnings).toEqual([]);
    expect(result.outputFiles).toHaveLength(1);
  });
});
