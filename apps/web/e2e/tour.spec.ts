/**
 * The guided tour in real browsers, on the production build (#27, ADR 0016):
 * it starts once, leaves in one action, gives back exactly the view it found,
 * works by keyboard alone, never covers what it lights or scrolls a phone
 * sideways, and stays inside the Content Security Policy.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

const DEMO = /Preizkusi demo|Explore the demo/;

/** Collects policy violations and uncaught errors. */
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
    if (message.text().startsWith("csp-violation"))
      problems.push(message.text());
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror ${error.message}`);
  });
  return problems;
}

async function enterDemo(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: DEMO }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Waits until the stop has laid out: its explanations are on screen. */
async function settled(dialog: Locator): Promise<void> {
  await expect(dialog.locator(".tour-notes .tour-note").first()).toBeVisible();
  // Two frames for the layout pass after scrolling.
  await dialog.page().evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );
}

const stopCount = (dialog: Locator) =>
  dialog
    .locator(".tour-count")
    .textContent()
    .then((text) => {
      const numbers = (text ?? "").match(/\d+/g) ?? [];
      return Number(numbers[1] ?? "0");
    });

/** What the user's own view is: everything the tour must give back. */
async function snapshot(page: Page) {
  return page.evaluate(() => ({
    heading: document.querySelector("#main h1")?.textContent ?? "",
    tab:
      document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null,
    open: [...document.querySelectorAll("details.security[open]")].map(
      (d) => d.getAttribute("data-explain-key") ?? "",
    ),
    scrollY: Math.round(window.scrollY),
    tables: [...document.querySelectorAll<HTMLElement>(".table-scroll")].map(
      (t) => t.scrollLeft,
    ),
    focused:
      document.activeElement?.id ?? document.activeElement?.tagName ?? "",
  }));
}

test("starts on entering the demo, on Next, with Skip first in order", async ({
  page,
  browserName,
}) => {
  const dialog = await enterDemo(page);
  await expect(dialog.locator(".tour-next")).toBeFocused();
  // The drawing is decoration: the explanations are the dialog's list.
  await settled(dialog);
  await expect(dialog.locator("svg.tour-canvas")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(dialog.getByRole("list")).toHaveCount(1);
  await expect(dialog.getByRole("button").first()).toHaveText(
    /Preskoči ogled|Skip tour/,
  );
  // WebKit on macOS tabs only to fields unless Option is held, as in Safari.
  const back = browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab";
  await page.keyboard.press(back);
  await page.keyboard.press(back);
  await expect(dialog.getByRole("button").first()).toBeFocused();
});

test("Escape ends it and gives the screen and focus back", async ({ page }) => {
  const dialog = await enterDemo(page);
  await settled(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#main h1")).toBeFocused();
  await expect(page.locator('[data-explain="files.list"]')).toBeVisible();
});

test("never starts again on its own, and the banner replays it", async ({
  page,
}) => {
  const dialog = await enterDemo(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.locator(".app-header .brand, .app-header button").first().click();
  await page.getByRole("button", { name: DEMO }).first().click();
  await page.waitForTimeout(800);
  await expect(dialog).toHaveCount(0);
  await page.locator("#demo-tour").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".tour-count")).toHaveText(/\b1\b/);
});

for (const exit of ["Escape", "Skip", "Finish"] as const) {
  test(`${exit} gives back the user's tab, rows, scroll and focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const dialog = await enterDemo(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // The user's own view: the review, on the dividends tab, scrolled.
    for (let step = 0; step < 2; step += 1) {
      await page.locator(".actions-row .btn-primary").click();
    }
    await expect(page.locator("#review-tab-dividends")).toBeVisible();
    await page.locator("#review-tab-dividends").click();
    await page.evaluate(() => {
      window.scrollTo({ top: 420, behavior: "instant" });
      const table = document.querySelector<HTMLElement>(
        '[role="tabpanel"]:not([hidden]) .table-scroll',
      );
      if (table !== null) table.scrollLeft = 30;
    });
    await page.locator("#demo-tour").focus();
    const before = await snapshot(page);
    await page.locator("#demo-tour").click();
    await expect(dialog).toBeVisible();
    // Go to the stop that opens Apple's row on the gains tab.
    await dialog.locator(".tour-next").click();
    await dialog.locator(".tour-next").click();
    await settled(dialog);
    await expect(
      page.locator('details[data-explain-key="US0378331005"]'),
    ).toHaveAttribute("open", "");
    if (exit === "Escape") {
      await page.keyboard.press("Escape");
    } else if (exit === "Skip") {
      await dialog.getByRole("button").first().click();
    } else {
      const total = await stopCount(dialog);
      for (let k = 0; k < total * 3; k += 1) {
        await settled(dialog);
        const label = (await dialog.locator(".tour-next").textContent()) ?? "";
        await dialog.locator(".tour-next").click();
        if (/Končaj|Finish/.test(label)) break;
      }
    }
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => snapshot(page))
      .toEqual({ ...before, focused: "demo-tour" });
  });
}

test("goes through every stop with the keyboard alone", async ({ page }) => {
  const dialog = await enterDemo(page);
  const total = await stopCount(dialog);
  expect(total).toBeGreaterThan(1);
  for (let k = 0; k < total * 3 && (await dialog.isVisible()); k += 1) {
    await settled(dialog);
    await expect(dialog.locator(".tour-next")).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(dialog).toBeHidden();
  await expect(page.locator("#main h1")).toBeFocused();
});

for (const [width, height] of [
  [320, 640],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
] as const) {
  test(`at ${String(width)}x${String(height)}: nothing covers what a stop lights, nothing scrolls sideways, nothing is blocked`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const problems = await watch(page);
    const dialog = await enterDemo(page);
    const total = await stopCount(dialog);
    for (let k = 0; k < total * 3 && (await dialog.isVisible()); k += 1) {
      await settled(dialog);
      const check = await page.evaluate(() => {
        const frame = document.querySelector<SVGPathElement>(".tour-frame");
        const cut = frame?.getBBox() ?? null;
        const dock = document
          .querySelector(".tour-dock")
          ?.getBoundingClientRect();
        const boxes = [
          ...document.querySelectorAll(".tour-note.is-placed"),
        ].map((li) => li.getBoundingClientRect());
        const overlaps = (
          a: DOMRect,
          b: { x: number; y: number; width: number; height: number },
        ) =>
          a.left < b.x + b.width - 1 &&
          b.x < a.right - 1 &&
          a.top < b.y + b.height - 1 &&
          b.y < a.bottom - 1;
        return {
          sideways:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          covered:
            cut === null ? 0 : boxes.filter((box) => overlaps(box, cut)).length,
          outside: boxes.filter(
            (box) =>
              box.left < 0 ||
              box.right > window.innerWidth ||
              box.top < 0 ||
              (dock !== undefined && box.bottom > dock.top),
          ).length,
        };
      });
      expect(check, `stop ${String(k)}`).toEqual({
        sideways: false,
        covered: 0,
        outside: 0,
      });
      const label = (await dialog.locator(".tour-next").textContent()) ?? "";
      await dialog.locator(".tour-next").click();
      if (/Končaj|Finish/.test(label)) break;
    }
    await expect(dialog).toBeHidden();
    expect(problems).toEqual([]);
  });
}
