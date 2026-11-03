import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/**", "**/coverage/**", "**/.turbo/**"]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: builtinModules,
          patterns: [
            {
              group: [
                "node:*",
                "@kithwork/backend",
                "@kithwork/backend/**",
                "@kithwork/database",
                "@kithwork/database/**",
              ],
              message: "Shared contracts must remain browser-safe.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "process",
        "Buffer",
        "require",
        "__dirname",
        "__filename",
      ],
    },
  },
]);
