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

/** Waits until the stop in view has been laid out by the tour. */
async function settled(dialog: Locator): Promise<void> {
  await expect(dialog).toHaveAttribute("data-ready", "true");
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
    const apple = page.locator('details[data-explain-key="US0378331005"]');
    const appleOpen = () =>
      page.evaluate(
        () =>
          document.querySelector(
            'details[data-explain-key="US0378331005"][open]',
          ) !== null,
      );
    for (let k = 0; k < 12 && !(await appleOpen()); k += 1) {
      await settled(dialog);
      await dialog.locator(".tour-next").click();
    }
    await settled(dialog);
    await expect(apple).toHaveAttribute("open", "");
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

test("never runs over the user's own files", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /Use my files|Uporabi svoje datoteke/ })
    .click();
  await expect(page.locator("#main h1")).toBeFocused();
  await page.waitForTimeout(800);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#demo-tour")).toHaveCount(0);
});

test("outside the tour, a new screen still takes focus to its heading", async ({
  page,
}) => {
  const dialog = await enterDemo(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const files = await page.locator("#main h1").textContent();
  await page.locator(".actions-row .btn-primary").click();
  await expect(page.locator("#main h1")).not.toHaveText(files ?? "");
  await expect(page.locator("#main h1")).toBeFocused();
});

test("leaving the review and coming back opens it as new", async ({ page }) => {
  const dialog = await enterDemo(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  for (let step = 0; step < 2; step += 1) {
    await page.locator(".actions-row .btn-primary").click();
  }
  await page.locator("#review-tab-dividends").click();
  await page.locator("#review-tab-gains").click();
  await page
    .locator('details[data-explain-key="US0378331005"] > summary')
    .click();
  await page.locator("#review-tab-dividends").click();
  await page
    .getByRole("button", { name: /^(Back|Nazaj)$/ })
    .last()
    .click();
  await page.locator(".actions-row .btn-primary").click();
  await expect(page.locator("#review-tab-gains")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("details.security[open]")).toHaveCount(0);
});

test("Tab never reaches the page behind the tour", async ({
  page,
  browserName,
}) => {
  const dialog = await enterDemo(page);
  await settled(dialog);
  const forward = browserName === "webkit" ? "Alt+Tab" : "Tab";
  for (let k = 0; k < 6; k += 1) {
    await page.keyboard.press(forward);
    const outside = await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active !== null &&
        active !== document.body &&
        active.closest("dialog") === null
      );
    });
    expect(outside, `after ${String(k + 1)} Tab`).toBe(false);
  }
});

test("in forced colors the tour draws no dim and a system-color frame", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  const dialog = await enterDemo(page);
  await settled(dialog);
  const look = await page.evaluate(() => {
    const dim = document.querySelector(".tour-dim");
    const frame = document.querySelector(".tour-frame");
    return {
      dim: dim === null ? null : getComputedStyle(dim).fill,
      frame: frame === null ? null : getComputedStyle(frame).strokeWidth,
    };
  });
  expect(look.dim).toMatch(/transparent|rgba\(0, 0, 0, 0\)|none/);
  expect(look.frame).toBe("3px");
});

for (const [width, height] of [
  [844, 390],
  [320, 256],
] as const) {
  test(`at ${String(width)}x${String(height)} the dock stays usable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const dialog = await enterDemo(page);
    await settled(dialog);
    const skip = await dialog.getByRole("button").first().boundingBox();
    expect(skip).not.toBeNull();
    expect(skip?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((skip?.y ?? 0) + (skip?.height ?? 0)).toBeLessThanOrEqual(height);
    await expect(dialog.locator(".tour-next")).toBeInViewport();
    // One explanation at a time here: Next shows the stop's second one.
    await dialog.locator(".tour-next").click();
    await settled(dialog);
    await expect(dialog.locator(".tour-note-count")).toHaveText(/^2\D/);
    await expect(dialog.locator(".tour-next")).toBeInViewport();
  });
}
