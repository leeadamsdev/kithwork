import { rm } from "node:fs/promises";

// Turbo runs this before cache restoration; direct package builds also run it.
await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
