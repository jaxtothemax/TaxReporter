// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  // ESLint covers the application and its tooling config, and nothing else.
  // Everything outside that is the Blueprint delivery harness (scripts/,
  // hooks/, .claude/, .github/, docs/, website/, ...), which keeps its own
  // conventions and gates: `make lint` must never report on it, and
  // `eslint --fix` must never rewrite it. Same allowlist as .prettierignore:
  // ignore every top-level entry, then re-include the application trees and
  // the root config files by name.
  globalIgnores([
    "*",
    "!packages/",
    "!apps/",
    "!*.config.js",
    "!*.config.ts",
    "**/dist/",
    "**/coverage/",
  ]),
  {
    files: ["**/*.{js,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
