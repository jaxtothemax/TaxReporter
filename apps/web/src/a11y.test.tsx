/**
 * Structural accessibility checks on the server-rendered markup of every
 * screen in both languages. They cannot replace a screen reader, but they stop
 * the regressions a static read can see: dangling ARIA references, unnamed
 * tables, skipped heading levels, and labels that hide visible content.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { demoPreview } from "./demo/demoPreview";
import type { Locale } from "./i18n/format";
import { I18nProvider } from "./i18n/i18n";
import { DividendsPanel } from "./screens/review/DividendsPanel";
import { GainsPanel } from "./screens/review/GainsPanel";
import { NotesPanel } from "./screens/review/NotesPanel";
import {
  initialWizardState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "./state/wizard";
import { engineReplies, ownState, preparedState } from "./testing/ownFiles";
import type { TourState } from "./tour/machine";
import { TOUR } from "./tour/script";

function stateAfter(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState);
}

// The user's own files, as the engine reads and prepares them.
const { read, prepared } = await engineReplies();

const stopOf = (id: string) => TOUR.findIndex((stop) => stop.id === id);
const touring = (id: string): TourState => ({
  seen: true,
  run: { stop: stopOf(id), note: 0 },
});

const SCREENS: [string, WizardState, TourState?][] = [
  ["start", initialWizardState],
  ["files", stateAfter({ type: "startDemo" })],
  ["details", stateAfter({ type: "startDemo" }, { type: "next" })],
  [
    "review",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "review" }),
  ],
  [
    "download",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "download" }),
  ],
  ["files, own files read", ownState(read)],
  ["details, own files with dividend payers", ownState(read, { type: "next" })],
  ["details with an error", ownState(read, { type: "next" }, { type: "next" })],
  ["review, own files", preparedState(read, prepared)],
  ["download, own files", preparedState(read, prepared, { type: "next" })],
  // The guided tour open over the demo: its dialog joins the page's checks.
  ["tour on the files", stateAfter({ type: "startDemo" }), touring("files")],
  [
    "tour on a security",
    stateAfter({ type: "startDemo" }),
    touring("saleRate"),
  ],
  ["tour on a dividend", stateAfter({ type: "startDemo" }), touring("holiday")],
  [
    "tour on the download",
    stateAfter({ type: "startDemo" }),
    touring("download"),
  ],
];

/** The review panels on their own, as the review's tabs hold them. */
function panels(locale: Locale): string {
  const wrap = (node: ReactNode) =>
    renderToStaticMarkup(
      <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
    );
  return [
    wrap(
      <GainsPanel
        securities={demoPreview.securities}
        estimate={demoPreview.gainsEstimate}
        open={new Set()}
        onToggle={() => undefined}
      />,
    ),
    wrap(
      <DividendsPanel
        dividends={demoPreview.dividends}
        totals={demoPreview.dividendsEstimate}
      />,
    ),
    wrap(
      <NotesPanel
        findings={prepared.preview.findings}
        symbols={prepared.preview.symbols}
        fileNames={["t212-2025.csv", "t212-2026.csv", "ibkr.xml"]}
      />,
    ),
  ].join("\n");
}

const ids = (html: string) =>
  new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const headingLevels = (html: string) =>
  [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

for (const locale of ["sl", "en"] as const) {
  describe(`accessibility structure (${locale})`, () => {
    for (const [name, state, tour] of SCREENS) {
      const html = renderToStaticMarkup(
        <App
          initialLocale={locale}
          initialState={state}
          {...(tour === undefined ? {} : { initialTour: tour })}
        />,
      );

      if (tour !== undefined) {
        it(`${name}: the tour's dialog is there, labelled by its heading`, () => {
          expect(html).toMatch(/<dialog[^>]*aria-labelledby="tour-title"/);
        });
      }

      it(`${name}: every aria-labelledby and aria-describedby target exists`, () => {
        const known = ids(html);
        for (const m of html.matchAll(
          /aria-(?:labelledby|describedby)="([^"]+)"/g,
        )) {
          for (const id of (m[1] ?? "").split(/\s+/)) {
            expect(known.has(id), `missing #${id}`).toBe(true);
          }
        }
      });

      it(`${name}: every aria-controls target exists and ids are unique`, () => {
        const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(all).size, "duplicate id").toBe(all.length);
        const known = ids(html);
        for (const m of html.matchAll(/aria-controls="([^"]+)"/g)) {
          expect(known.has(m[1] ?? ""), `missing #${m[1] ?? ""}`).toBe(true);
        }
      });

      it(`${name}: one h1, and no heading level is skipped`, () => {
        const levels = headingLevels(html);
        expect(levels.filter((l) => l === 1)).toHaveLength(1);
        levels.reduce((previous, level) => {
          expect(
            level,
            `h${String(previous)} followed by h${String(level)}`,
          ).toBeLessThanOrEqual(previous + 1);
          return level;
        }, 1);
      });
    }

    it("the review panels name every table and leave summaries their visible names", () => {
      const html = panels(locale);
      const tables = html.match(/<table[^>]*>/g) ?? [];
      const captions = html.match(/<table[^>]*>\s*<caption/g) ?? [];
      expect(tables.length).toBeGreaterThan(0);
      expect(captions).toHaveLength(tables.length);
      // A table wider than a phone scrolls sideways, and only a focusable
      // scroller can be scrolled from the keyboard (WCAG 2.1.1): each one sits
      // in a named region that takes focus.
      const scrollers =
        html.match(
          /<div class="table-scroll" role="region" aria-label="[^"]+" tabindex="0"[^>]*><table/g,
        ) ?? [];
      expect(scrollers).toHaveLength(tables.length);
      expect(html).not.toMatch(/<summary[^>]*aria-label=/);
      const known = ids(html);
      for (const m of html.matchAll(/aria-describedby="([^"]+)"/g)) {
        expect(known.has(m[1] ?? ""), `missing #${m[1] ?? ""}`).toBe(true);
      }
    });
  });
}
