import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/config.ts",
        "src/platform/lifecycle/runtime.ts",
        "src/features/organisations/policies.ts",
      ],
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
