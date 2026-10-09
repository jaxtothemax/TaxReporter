/**
 * The tour's script against the demo it is written for (#27, ADR 0016): every
 * element a stop points at exists where the stop shows it, every explanation
 * names what the screen shows, and every equation it states holds.
 */
import { Decimal } from "@taxreporter/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../App";
import { demoPreview } from "../demo/demoPreview";
import { describe as describePath, type AnchorPath } from "../explain/anchors";
import type { Locale } from "../i18n/format";
import { en, sl, type Messages } from "../i18n/messages";
import { HOLDING_BUCKETS } from "../model/preview";
import { FLOW_STEPS, initialWizardState, wizardReducer } from "../state/wizard";
import { DEMO_AAPL, NOTE_COUNTS, TOUR } from "./script";

const LOCALES: readonly [Locale, Messages][] = [
  ["en", en],
  ["sl", sl],
];

const demo = wizardReducer(initialWizardState, { type: "startDemo" });

/** The app as it renders with the tour on stop `stop`, already seen. */
function renderStop(stop: number, locale: Locale): string {
  return renderToStaticMarkup(
    <App
      initialLocale={locale}
      initialState={demo}
      initialTour={{ seen: true, run: { stop, note: 0 } }}
    />,
  );
}

/** Visible text, tags stripped, entities decoded, every space one space. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\s\u00a0\u202f]+/g, " ");
}

/** Whether every step of `path` is in the markup, with its key. */
function hasPath(html: string, anchors: AnchorPath): boolean {
  return anchors.every((ref) =>
    ref.key === undefined
      ? html.includes(`data-explain="${ref.name}"`)
      : html.includes(
          `data-explain="${ref.name}" data-explain-key="${ref.key}"`,
        ),
  );
}

/** The markup of the page behind the tour: everything but the dialog. */
const page = (html: string) => html.replace(/<dialog[\s\S]*<\/dialog>/, "");

describe("the script", () => {
  it("has one to three explanations a stop, as the reducer counts them", () => {
    expect(NOTE_COUNTS).toEqual(TOUR.map((stop) => stop.notes.length));
    for (const stop of TOUR) {
      expect(stop.notes.length, stop.id).toBeGreaterThanOrEqual(1);
      expect(stop.notes.length, stop.id).toBeLessThanOrEqual(3);
      const targets = stop.notes.map((note) => describePath(note.target));
      expect(new Set(targets).size, stop.id).toBe(targets.length);
    }
    expect(new Set(TOUR.map((stop) => stop.id)).size).toBe(TOUR.length);
  });

  it("shows only screens of the flow and securities the demo sold", () => {
    const sold = new Set(demoPreview.securities.map((s) => s.isin));
    for (const stop of TOUR) {
      expect(FLOW_STEPS, stop.id).toContain(stop.view.screen);
      for (const isin of stop.view.review?.open ?? []) {
        expect(sold.has(isin), `${stop.id}: ${isin}`).toBe(true);
      }
    }
  });

  it("has every explanation in both languages, for the demo", () => {
    for (const [locale, t] of LOCALES) {
      for (const stop of TOUR) {
        const context = { t, locale, preview: demoPreview };
        expect(stop.title(context).trim(), stop.id).not.toBe("");
        expect(stop.intro(context).trim(), stop.id).not.toBe("");
        stop.notes.forEach((note, i) => {
          const written = note.text(context);
          expect(written, `${locale} ${stop.id} #${String(i)}`).not.toBeNull();
        });
      }
    }
  });
});

describe("each stop on the screen it shows", () => {
  for (const [locale, t] of LOCALES) {
    TOUR.forEach((stop, index) => {
      it(`${locale} ${stop.id}: lights and points at elements that exist`, () => {
        const html = page(renderStop(index, locale));
        for (const anchors of stop.focus) {
          expect(hasPath(html, anchors), describePath(anchors)).toBe(true);
        }
        for (const note of stop.notes) {
          expect(hasPath(html, note.target), describePath(note.target)).toBe(
            true,
          );
        }
      });

      it(`${locale} ${stop.id}: names each target as the screen shows it, figures included`, () => {
        const shown = text(page(renderStop(index, locale)));
        for (const note of stop.notes) {
          const written = note.text({ t, locale, preview: demoPreview });
          if (written === null) continue;
          expect(shown, `lead of ${describePath(note.target)}`).toContain(
            text(written.lead).trim(),
          );
          // Every figure with decimals in the explanation is on the screen.
          for (const figure of text(written.body).match(/\d[\d.,]*[.,]\d+/g) ??
            []) {
            expect(
              shown,
              `${figure} in ${describePath(note.target)}`,
            ).toContain(figure);
          }
        }
      });
    });
  }

  it("shows each stop's screen in place of the user's, the dialog labelled", () => {
    TOUR.forEach((stop, index) => {
      const html = renderStop(index, "en");
      const heading = {
        files: en.files.title,
        details: en.details.title,
        review: en.review.title(String(demoPreview.taxYear)),
        download: en.download.title,
      }[stop.view.screen];
      expect(text(page(html)), stop.id).toContain(heading);
      expect(html).toMatch(/<dialog[^>]*aria-labelledby="tour-title"/);
    });
  });
});

describe("the equations the explanations state", () => {
  const d = (value: string) => Decimal.parse(value);
  const estimate = demoPreview.gainsEstimate;

  it("adds this year's losses to the gains to make the net taxable gain", () => {
    const positive = Decimal.sum(
      HOLDING_BUCKETS.map((b) => d(estimate.positiveByBucket[b])),
    );
    expect(positive.plus(d(estimate.lossesEur)).toPlain(2, "halfUp")).toBe(
      estimate.netBaseEur,
    );
  });

  it("taxes each part of the net gain at its holding period's rate", () => {
    const rate = {
      "25": "0.25",
      "20": "0.20",
      "15": "0.15",
      "0": "0",
    } as const;
    const tax = Decimal.sum(
      HOLDING_BUCKETS.map((b) =>
        d(estimate.allocatedByBucket[b]).times(d(rate[b])),
      ),
    );
    expect(tax.toPlain(2, "halfUp")).toBe(estimate.taxEur);
  });

  it("divides the sale's price by Banka Slovenije's rate, to 8 places, on the trade date", () => {
    const apple = demoPreview.securities.find((s) => s.isin === DEMO_AAPL);
    const sale = apple?.rows.find((row) => row.kind === "sale");
    expect(sale?.rate).not.toBeNull();
    if (sale === undefined || sale.rate === null) return;
    expect(sale.rate.source).toBe("bsi-daily");
    expect(sale.rate.listDate).toBe(sale.date);
    expect(
      d(sale.price.amount).dividedBy(d(sale.rate.rate)).toPlain(8, "halfUp"),
    ).toBe(sale.priceEur);
  });
});

describe("what the tour must never say or do", () => {
  const sayings = (t: Messages) =>
    JSON.stringify(
      { tour: t.tour, explain: t.explain },
      (_key, value: unknown) =>
        typeof value === "function"
          ? (value as (...args: string[]) => string)(
              "<a>",
              "<b>",
              "<c>",
              "<d>",
              "<e>",
            )
          : value,
    );

  it("names no broker the demo does not cover, and never 'your case'", () => {
    for (const [, t] of LOCALES) {
      expect(sayings(t)).not.toMatch(
        /Schwab|eToro|Revolut|in your case|v vašem primeru/i,
      );
    }
  });

  it("writes no style the production policy would block, anywhere in the app", () => {
    // Every source file of the app, read as text (Vite's glob, in Vitest too).
    const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const files = Object.entries(sources).filter(
      ([path]) => !/\.test\.tsx?$/.test(path),
    );
    expect(files.length).toBeGreaterThan(10);
    // Comments may name what they forbid; only code is checked.
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const banned =
      /cssText|setAttribute\(\s*["']style["']|<style[\s>]|\.style\s*=[^=]/;
    for (const [path, source] of files) {
      expect(code(source), path).not.toMatch(banned);
    }
  });
});
