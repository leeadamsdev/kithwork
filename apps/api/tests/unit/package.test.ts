import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps the typed client browser bundle free of server runtime dependencies", async () => {
  const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL("../fixtures/browser-client.ts", import.meta.url)),
    ],
    bundle: true,
    platform: "browser",
    write: false,
    metafile: true,
  });
  expect(Object.keys(bundle.metafile.inputs).join("\n")).not.toMatch(
    /node_modules\/(?:fastify|ioredis|drizzle-orm|pg|pino)\/|apps\/api\/(?:src|dist)\//,
  );
  expect(bundle.outputFiles[0]!.text).toContain("/trpc");
});
