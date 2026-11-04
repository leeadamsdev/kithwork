import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/config.ts", "src/runtime.ts"],
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
