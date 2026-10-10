/**
 * The built app in a real browser: it loads under its Content Security Policy
 * with nothing blocked, opens the demo, and never scrolls sideways on the
 * narrowest phone the design supports (apps/web/CLAUDE.md).
 */
import { expect, test, type Page } from "@playwright/test";

/** Collects every policy violation and uncaught error the page reports. */
async function watch(page: Page): Promise<string[]> {
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(
        `csp-violation ${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  page.on("console", (message) => {
    if (message.text().startsWith("csp-violation")) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror ${error.message}`);
  });
  return problems;
}

async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
}

test("the start screen loads under its policy, with nothing blocked", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/");
  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(problems).toEqual([]);
});

test("the demo opens, with nothing blocked", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/");
  const start = page.getByRole("heading", { level: 1 });
  const title = await start.textContent();
  await page
    .getByRole("button", { name: /Preizkusi demo|Explore the demo/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
    title ?? "",
  );
  expect(problems).toEqual([]);
});

test("nothing scrolls sideways at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await page
    .getByRole("button", { name: /Preizkusi demo|Explore the demo/ })
    .first()
    .click();
  // The guided tour starts on entering the demo; tour.spec.ts covers it.
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#main h1")).toBeFocused();
  expect(await scrollsSideways(page)).toBe(false);
  // A file's name keeps the width of its line; its broker chip moves under
  // it, rather than squeezing the name to a few letters a line.
  const names = await page
    .locator(".file-text")
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().width),
    );
  expect(names.length).toBeGreaterThan(0);
  expect(Math.min(...names)).toBeGreaterThan(150);
});

test("the watcher sees what the policy blocks", async ({ page }) => {
  // Proves the checks above can fail: an injected <style> element is exactly
  // what `style-src 'self'` refuses, and what a tour library would add.
  const problems = await watch(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "body { outline: 1px solid red; }";
    document.head.append(style);
  });
  await expect
    .poll(() => problems.join("\n"))
    .toMatch(/csp-violation style-src/);
});
