import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    teardownTimeout: 30_000,
    projects: [
      {
        test: {
          name: "tooling",
          sequence: { groupOrder: 0 },
          environment: "node",
          include: ["tests/tooling/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          sequence: { groupOrder: 1 },
          environment: "node",
          include: [
            "tests/integration/**/*.test.ts",
            "apps/api/tests/integration/**/*.test.ts",
          ],
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
        "apps/api/src/**/*.ts",
        "apps/api/dist/**/*.js",
      ],
      reportsDirectory: "coverage/integration",
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
