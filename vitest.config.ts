import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// One Vitest run over every workspace package, from the repository root, so
// `make test` produces ONE Cobertura report (coverage/cobertura-coverage.xml)
// with repo-relative paths. scripts/check-added-files-covered.mjs reads that
// report AND the coverage exclusion list below (see COVERAGE_LAYERS in the
// Makefile), so the gate and Vitest cannot disagree about what counts as source.
export default defineConfig({
  // Workspace packages export their TypeScript sources under the "source"
  // condition, so tests run against src/ without building dist/ first.
  resolve: { conditions: ["source", ...defaultServerConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  test: {
    // Any depth below a package, not just src/: a test file that no include
    // pattern reaches is one that silently never runs.
    include: ["packages/*/**/*.test.{ts,tsx}", "apps/*/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "cobertura"],
      reportsDirectory: "coverage",
      // No coverage `include` list, on purpose: with one, Vitest reports every
      // matching file — loaded or not — as a 0% row, and an added file that no
      // test ever imports would no longer be ABSENT from the report, which is
      // the signal check-added-files-covered.mjs exists to catch.
      //
      // The gate parses the list below with a regex and matches it against
      // paths relative to packages/ and apps/, not the repo root: keep every
      // pattern `**/`-anchored, brace-free, and the only exclusion list here.
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.d.ts",
        "**/*.config.ts",
        "**/*.json",
      ],
    },
  },
});
