import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    teardownTimeout: 30_000,
    projects: [
      {
        test: {
          name: "tooling",
          environment: "node",
          include: ["tests/tooling/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          pool: "forks",
          maxWorkers: 2,
          testTimeout: 10_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Include emitted modules so V8 can remap their coverage to the TypeScript sources.
      include: [
        "packages/database/src/**/*.ts",
        "packages/database/dist/**/*.js",
      ],
      reportsDirectory: "coverage/integration",
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
