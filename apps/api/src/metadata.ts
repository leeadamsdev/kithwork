import { systemInfoSchema } from "@kithwork/contracts";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
export const apiInfo = systemInfoSchema.parse({
  name: "kithwork-api",
  version: manifest.version,
});
