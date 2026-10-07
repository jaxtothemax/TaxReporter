/**
 * Server-rendered checks of every screen in both languages. The tests run in
 * Node without a DOM, so interaction is covered by the reducer's tests and
 * these assert what each state renders.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import type { Locale } from "./i18n/format";
import { en, sl } from "./i18n/messages";
import {
  initialWizardState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "./state/wizard";

function stateAfter(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState);
}

function render(state: WizardState, locale: Locale = "en"): string {
  return renderToStaticMarkup(
    <App initialLocale={locale} initialState={state} />,
  );
}

/** Visible text with tags stripped and entities decoded, for wording checks. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const demo = stateAfter({ type: "startDemo" });
const screens: [string, WizardState][] = [
  ["start", initialWizardState],
  ["files (demo)", demo],
  ["details (demo)", stateAfter({ type: "startDemo" }, { type: "next" })],
  [
    "review (demo)",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "review" }),
  ],
  [
    "download (demo)",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "download" }),
  ],
];

describe("App", () => {
  for (const [name, state] of screens) {
    for (const locale of ["sl", "en"] as const) {
      it(`renders ${name} in ${locale} without em or en dashes`, () => {
        const html = render(state, locale);
        expect(html.length).toBeGreaterThan(1000);
        expect(text(html)).not.toMatch(/[\u2013\u2014]/);
      });
    }
  }

  it("leads the start screen with the value proposition and both entry points", () => {
    const html = text(render(initialWizardState, "sl"));
    expect(html).toContain(sl.start.title);
    expect(html).toContain(sl.start.primaryCta);
    expect(html).toContain(sl.start.secondaryCta);
    // The preview card is a real row of the demo data with its BSI rate.
    expect(html).toContain("1 EUR = 1,1547 USD");
  });

  it("never groups the digits of a year", () => {
    const review = text(render(screens[3]?.[1] ?? demo, "en"));
    expect(review).toContain("Review tax year 2026");
    expect(text(render(demo, "en"))).toContain("Tax year 2026");
    expect(review).not.toContain("2,026");
  });

  it("keeps each form name on one line in the hero headline", () => {
    const html = render(initialWizardState, "sl");
    expect(html).toContain('<span class="nowrap">Doh-KDVP</span>');
    expect(html).toContain('<span class="nowrap">Doh-Div</span>');
  });

  it("marks every flow screen of the demo as demo data", () => {
    for (const [name, state] of screens.slice(1)) {
      expect(text(render(state)), name).toContain(en.demoBanner.body);
    }
    expect(text(render(initialWizardState))).not.toContain(en.demoBanner.body);
  });

  it("marks the current step for assistive technology", () => {
    const html = render(stateAfter({ type: "startDemo" }, { type: "next" }));
    expect(html).toMatch(/aria-current="step"[^>]*>.*?Details/);
  });

  it("shows the review's headline figures from the demo data", () => {
    const html = text(render(screens[3]?.[1] ?? demo, "en"));
    expect(html).toContain("€1,770.04");
    expect(html).toContain("€182.59");
    expect(html).toContain("€21.33");
    expect(html).toContain("Apple Inc.");
  });

  it("shows an empty review, not made-up numbers, for the user's own files", () => {
    const own = stateAfter(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "export.csv", size: 2048 }] },
      { type: "setDetail", field: "taxNumber", value: "12345678" },
      { type: "goTo", screen: "review" },
    );
    expect(own.screen).toBe("review");
    const html = text(render(own));
    expect(html).toContain(en.review.emptyTitle);
    expect(html).not.toContain("€1,770.04");
  });

  it("lists the user's own files as not read yet", () => {
    const own = stateAfter(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "export.csv", size: 2048 }] },
    );
    const html = text(render(own));
    expect(html).toContain("export.csv");
    expect(html).toContain("not read yet");
    expect(html).toContain(en.files.ownFilesNotice);
  });

  it("explains a missing file and a missing tax number inline", () => {
    const noFile = stateAfter({ type: "startOwn" }, { type: "next" });
    expect(text(render(noFile))).toContain(en.files.needFiles);

    const badTaxNumber = stateAfter(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "a.csv", size: 1 }] },
      { type: "next" },
      { type: "next" },
    );
    const html = render(badTaxNumber);
    expect(text(html)).toContain(en.details.taxNumberError);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]*details-taxNumber-error/);
  });

  it("never shows a blank Download screen for unread own files", () => {
    const own = stateAfter(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "export.csv", size: 2048 }] },
      { type: "setDetail", field: "taxNumber", value: "12345678" },
      { type: "goTo", screen: "download" },
    );
    // Own files block at the review, so the jump is refused...
    expect(own.screen).toBe("files");
    // ...and even a forced download state renders a message, not nothing.
    const forced = text(render({ ...own, screen: "download" }));
    expect(forced).toContain(en.review.emptyTitle);
  });

  it("refuses files that are not CSV or XML, and says so", () => {
    const state = stateAfter(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "statement.pdf", size: 9000 }] },
      { type: "next" },
    );
    const html = text(render(state));
    expect(state.screen).toBe("files");
    expect(html).toContain(en.files.unsupported);
    expect(html).toContain(en.files.unsupportedBlocked);
  });

  it("points out the demo's warning above the review tabs", () => {
    const html = text(render(screens[3]?.[1] ?? demo, "en"));
    expect(html).toContain("1 note needs your attention before you download.");
  });

  it("keeps the download buttons disabled and says why", () => {
    const html = render(screens[4]?.[1] ?? demo, "sl");
    const buttons =
      html.match(/<button[^>]*>[^]*?Prenesi Doh-(?:KDVP|Div)/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain("disabled");
    expect(text(html)).toContain(sl.download.notBuilt);
    // Tax year 2026 is due on Monday 1 March 2027 (28 February is a Sunday).
    expect(text(html)).toContain("1. 3. 2027");
  });
});
