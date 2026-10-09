import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests, run against the production build that `vite preview` serves.
 * The Content Security Policy is a build-only <meta> tag (vite.config.ts), so
 * only the built app shows what the policy blocks: build first. `make
 * test-e2e` builds and runs; locally, `pnpm exec playwright install chromium
 * firefox webkit` fetches the browsers once. CI runs in Microsoft's Playwright
 * image, pinned to this package's version (.github/workflows/ci.yml).
 *
 * Specs are `e2e/*.spec.ts`, never `*.test.ts`: Vitest runs every `*.test.*`
 * in Node, where a browser test cannot run.
 */

// Not vite's default 4173, so a preview someone is using is left alone.
const PORT = 4174;
const URL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  // No automatic retry (.github/workflows/CLAUDE.md): a flaky test is a bug.
  retries: 0,
  reporter:
    process.env["CI"] === undefined
      ? "list"
      : [["list"], ["html", { open: "never" }]],
  use: { baseURL: URL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: URL,
    reuseExistingServer: false,
  },
});
