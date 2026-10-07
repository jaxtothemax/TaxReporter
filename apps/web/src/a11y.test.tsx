/**
 * Structural accessibility checks on the server-rendered markup of every
 * screen in both languages. They cannot replace a screen reader, but they stop
 * the regressions a static read can see: dangling ARIA references, unnamed
 * tables, skipped heading levels, and labels that hide visible content.
 */
import { Theme } from "@radix-ui/themes";
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

function stateAfter(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState);
}

const SCREENS: [string, WizardState][] = [
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
  [
    "details with an error",
    stateAfter(
      { type: "startOwn" },
      { type: "addFiles", files: [{ name: "a.csv", size: 1 }] },
      { type: "next" },
      { type: "next" },
    ),
  ],
];

/** The review's inactive tabs are not rendered by Radix, so render them too. */
function panels(locale: Locale): string {
  const wrap = (node: ReactNode) =>
    renderToStaticMarkup(
      <I18nProvider initialLocale={locale}>
        <Theme>{node}</Theme>
      </I18nProvider>,
    );
  return [
    wrap(
      <GainsPanel
        securities={demoPreview.securities}
        estimate={demoPreview.gainsEstimate}
      />,
    ),
    wrap(
      <DividendsPanel
        dividends={demoPreview.dividends}
        totals={demoPreview.dividendsEstimate}
      />,
    ),
    wrap(<NotesPanel diagnostics={demoPreview.diagnostics} />),
  ].join("\n");
}

const ids = (html: string) =>
  new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const headingLevels = (html: string) =>
  [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

for (const locale of ["sl", "en"] as const) {
  describe(`accessibility structure (${locale})`, () => {
    for (const [name, state] of SCREENS) {
      const html = renderToStaticMarkup(
        <App initialLocale={locale} initialState={state} />,
      );

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
      expect(html).not.toMatch(/<summary[^>]*aria-label=/);
      const known = ids(html);
      for (const m of html.matchAll(/aria-describedby="([^"]+)"/g)) {
        expect(known.has(m[1] ?? ""), `missing #${m[1] ?? ""}`).toBe(true);
      }
    });
  });
}
