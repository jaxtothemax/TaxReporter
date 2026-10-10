/**
 * The tour's script against the demo it is written for (#27, ADR 0016): every
 * element a stop points at exists where the stop shows it, every explanation
 * names what the screen shows, and every equation it states holds.
 */
import { bucketFor, completedYears, Decimal } from "@taxreporter/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../App";
import { demoPreview } from "../demo/demoPreview";
import {
  describe as describePath,
  EXPLAIN_NAMES,
  resolve,
  type AnchorPath,
} from "../explain/anchors";
import type { Locale } from "../i18n/format";
import { en, sl, type Messages } from "../i18n/messages";
import { HOLDING_BUCKETS } from "../model/preview";
import { FLOW_STEPS, initialWizardState, wizardReducer } from "../state/wizard";
import {
  DEMO_AAPL,
  DEMO_ASML,
  DEMO_HOLIDAY,
  DEMO_NVDA,
  DEMO_TREATY,
  DEMO_VWCE,
  NOTE_COUNTS,
  TOUR,
} from "./script";

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

describe("what the later stops say of the demo", () => {
  const d = (value: string) => Decimal.parse(value);
  const sec = (isin: string) => {
    const found = demoPreview.securities.find((s) => s.isin === isin);
    if (found === undefined) throw new Error(`the demo lacks ${isin}`);
    return found;
  };
  const sum = (values: readonly string[]) => Decimal.sum(values.map(d));
  const bought = (isin: string, date: string) =>
    sec(isin).rows.find((row) => row.kind === "purchase" && row.date === date);

  it("gives each Apple lot the rate of its completed years, the oldest sold first", () => {
    const apple = sec(DEMO_AAPL);
    const sale = apple.rows.find((row) => row.kind === "sale");
    for (const lot of apple.lots) {
      expect(lot.yearsHeld).toBe(
        completedYears(lot.purchaseDate, lot.saleDate),
      );
      expect(lot.bucket).toBe(bucketFor(lot.yearsHeld));
    }
    const [first, second] = apple.lots;
    expect(first?.quantity).toBe(
      bought(DEMO_AAPL, first?.purchaseDate ?? "")?.quantity,
    );
    expect(
      sum(apple.lots.map((lot) => lot.quantity)).equals(
        d(sale?.quantity ?? "0"),
      ),
    ).toBe(true);
    expect(first?.purchaseDate.localeCompare(second?.purchaseDate ?? "")).toBe(
      -1,
    );
  });

  it("matches NVIDIA's sale with the Trading 212 purchase first, then IBKR's", () => {
    const nvidia = sec(DEMO_NVDA);
    const sale = nvidia.rows.find((row) => row.kind === "sale");
    const [first, second] = nvidia.lots;
    expect(bought(DEMO_NVDA, first?.purchaseDate ?? "")?.broker).toBe(
      "trading212",
    );
    expect(bought(DEMO_NVDA, second?.purchaseDate ?? "")?.broker).toBe("ibkr");
    expect(sale?.broker).toBe("ibkr");
    expect(
      sum(nvidia.lots.map((lot) => lot.quantity)).equals(
        d(sale?.quantity ?? "0"),
      ),
    ).toBe(true);
  });

  it("sells VWCE's oldest buys first, the last of them only in part", () => {
    const etf = sec(DEMO_VWCE);
    const buys = etf.rows.filter((row) => row.kind === "purchase");
    expect(etf.lots.map((lot) => lot.purchaseDate)).toEqual(
      buys.slice(0, etf.lots.length).map((row) => row.date),
    );
    expect(
      sum(etf.lots.map((lot) => lot.quantity)).equals(d(etf.quantitySold)),
    ).toBe(true);
    const partial = etf.lots.filter(
      (lot) => bought(DEMO_VWCE, lot.purchaseDate)?.quantity !== lot.quantity,
    );
    expect(partial).toHaveLength(1);
    expect(partial[0]).toBe(etf.lots.at(-1));
    expect(etf.rows.every((row) => row.rate === null)).toBe(true);
  });

  it("counts ASML's whole loss: no purchase within 30 days of the sale", () => {
    const asml = sec(DEMO_ASML);
    const sale = asml.rows.find((row) => row.kind === "sale");
    expect(d(asml.gainEur).isNegative()).toBe(true);
    expect(
      d(asml.proceedsEur).minus(d(asml.costEur)).equals(d(asml.gainEur)),
    ).toBe(true);
    const day = 86_400_000;
    for (const row of asml.rows.filter((r) => r.kind === "purchase")) {
      const apart =
        Math.abs(
          Date.parse(`${row.date}T00:00:00Z`) -
            Date.parse(`${sale?.date ?? ""}T00:00:00Z`),
        ) / day;
      expect(apart).toBeGreaterThan(30);
    }
    expect(
      demoPreview.findings.some(
        (f) => f.code === "lossCounts" && f.params["isin"] === DEMO_ASML,
      ),
    ).toBe(true);
  });

  it("converts AT&T's holiday dividend at the list before it, to the cent", () => {
    const paid = demoPreview.dividends.find(
      (x) => x.isin === DEMO_HOLIDAY.isin && x.date === DEMO_HOLIDAY.date,
    );
    expect(paid?.rate).not.toBeNull();
    if (paid === undefined || paid.rate === null) return;
    // 1 May 2026 is a Friday: a weekday with no list is a TARGET holiday.
    expect(new Date(`${paid.date}T00:00:00Z`).getUTCDay()).toBe(5);
    expect(paid.rate.listDate).toBe("2026-04-30");
    expect(
      d(paid.gross.amount).dividedBy(d(paid.rate.rate)).toPlain(2, "halfUp"),
    ).toBe(paid.grossEur);
  });

  it("credits Allianz's withholding at the treaty rate, the rest not credited", () => {
    const paid = demoPreview.dividends.find(
      (x) => x.isin === DEMO_TREATY.isin && x.date === DEMO_TREATY.date,
    );
    const finding = demoPreview.findings.find(
      (f) =>
        f.code === "excessWithholding" && f.params["isin"] === DEMO_TREATY.isin,
    );
    if (
      paid === undefined ||
      paid.treatyRate === null ||
      finding === undefined
    ) {
      throw new Error("the demo lacks the treaty case");
    }
    expect(
      d(paid.grossEur).times(d(paid.treatyRate)).toPlain(2, "halfUp"),
    ).toBe(paid.creditEur);
    expect(
      d(paid.foreignTaxEur).minus(d(paid.creditEur)).toPlain(2, "halfUp"),
    ).toBe(finding.params["excessEur"]);
  });
});

describe("finding what an explanation points at", () => {
  /** A minimal DOM: elements with attributes and children, searched in order. */
  interface Fake {
    readonly attrs: Readonly<Record<string, string>>;
    readonly children: readonly Fake[];
  }
  const node = (attrs: Record<string, string>, ...children: Fake[]): Fake => ({
    attrs,
    children,
  });
  const all = (root: Fake): Fake[] =>
    root.children.flatMap((child) => [child, ...all(child)]);
  const element = (fake: Fake): Element & ParentNode => {
    const wrap = {
      getAttribute: (name: string) => fake.attrs[name] ?? null,
      querySelectorAll: (selector: string) => {
        const name = /^\[data-explain="([^"]+)"\]$/.exec(selector)?.[1];
        if (name === undefined)
          throw new Error(`a selector beyond a name: ${selector}`);
        return all(fake)
          .filter((f) => f.attrs["data-explain"] === name)
          .map(element);
      },
    };
    return wrap as unknown as Element & ParentNode;
  };

  it("matches keys as text, whatever they hold, and never parses them", () => {
    const hostile = [
      'quote"d',
      "back\\slash",
      "a]b",
      "line\nbreak",
      "cr\rlf",
      "form\ffeed",
      "nul\u0000",
      "lone\ud800",
      '"],[data-explain]',
    ];
    const root = node(
      {},
      ...hostile.map((key) =>
        node(
          { "data-explain": "files.text", "data-explain-key": key },
          node({ "data-explain": "sec.rate", "data-explain-key": `in ${key}` }),
        ),
      ),
    );
    hostile.forEach((key, i) => {
      const found = resolve(element(root), [{ name: "files.text", key }]);
      expect(found?.getAttribute("data-explain-key"), `key ${String(i)}`).toBe(
        key,
      );
      const inner = resolve(element(root), [
        { name: "files.text", key },
        { name: "sec.rate", key: `in ${key}` },
      ]);
      expect(inner?.getAttribute("data-explain-key")).toBe(`in ${key}`);
    });
    expect(
      resolve(element(root), [{ name: "files.text", key: "absent" }]),
    ).toBeNull();
  });

  it("is marked on a screen for every name it knows", () => {
    const sources = import.meta.glob<string>("../screens/**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const screens = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx$/.test(path))
      .map(([, source]) => source)
      .join("\n");
    for (const name of EXPLAIN_NAMES) {
      expect(screens, name).toContain(`explain("${name}"`);
    }
  });
});

describe("the rules the explanations state", () => {
  it("says the holding-period thresholds core applies", () => {
    // holdingSchedule names 5, 10 and 15 completed years.
    expect([bucketFor(4), bucketFor(5), bucketFor(9), bucketFor(10)]).toEqual([
      "25",
      "20",
      "20",
      "15",
    ]);
    expect([bucketFor(14), bucketFor(15)]).toEqual(["15", "0"]);
    for (const [, t] of LOCALES) {
      const said = t.explain.holdingSchedule("a", "b", "c", "d", "e", "f");
      for (const years of ["5", "10", "15"]) expect(said).toContain(years);
    }
  });
});

describe("the sentences the tour renders", () => {
  const written = (locale: Locale, t: Messages) =>
    TOUR.map((stop) => {
      const context = { t, locale, preview: demoPreview };
      return {
        stop: stop.id,
        title: stop.title(context),
        intro: stop.intro(context),
        notes: stop.notes.map((note) => note.text(context)),
      };
    });

  /** A figure as the locale writes it, back to a plain decimal string. */
  const plain = (figure: string, locale: Locale) => {
    const bare = figure
      .replace(/€|USD|EUR|GBP|%/g, "")
      .replace(/[\s\u00a0\u202f]/g, "")
      .replace(/−/g, "-");
    return locale === "en"
      ? bare.replace(/,/g, "")
      : bare.replace(/\./g, "").replace(/,/g, ".");
  };
  const FIGURE =
    "(?:(?:€|USD|EUR|GBP)[\\s\\u00a0]?)?[\\u2212-]?\\d+(?:[.,]\\d+)*(?:[\\s\\u00a0]?(?:%|€|USD|EUR|GBP))?";
  const EQUATION = new RegExp(
    `(${FIGURE}(?:[\\s\\u00a0]*[×÷+][\\s\\u00a0]*${FIGURE})+)[\\s\\u00a0]*=[\\s\\u00a0]*(${FIGURE})`,
    "g",
  );

  /** The left side's value: × and ÷ before +, a percentage as a fraction. */
  function evaluate(left: string, locale: Locale): Decimal {
    const terms = left.split(/[\s\u00a0]*\+[\s\u00a0]*/);
    return Decimal.sum(
      terms.map((term) => {
        const parts = term.split(/[\s\u00a0]*([×÷])[\s\u00a0]*/);
        const value = (figure: string) => {
          const number = Decimal.parse(plain(figure, locale));
          return figure.includes("%")
            ? number.dividedBy(Decimal.parse("100"))
            : number;
        };
        let result = value(parts[0] ?? "0");
        for (let k = 1; k < parts.length; k += 2) {
          const operand = value(parts[k + 1] ?? "0");
          result =
            parts[k] === "×"
              ? result.times(operand)
              : result.dividedBy(operand);
        }
        return result;
      }),
    );
  }

  for (const [locale, t] of LOCALES) {
    it(`${locale}: says what was reviewed, word for word`, () => {
      // No-break spaces and the minus sign written out, so a reviewer sees
      // them where a space or a hyphen would look the same.
      const shown = JSON.stringify(written(locale, t), null, 2).replace(
        /[\u00a0\u202f\u2212]/g,
        (char) =>
          `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`,
      );
      expect(shown).toMatchSnapshot();
    });

    it(`${locale}: states only equations that hold, at their stated precision`, () => {
      let checked = 0;
      for (const stop of written(locale, t)) {
        for (const note of stop.notes) {
          if (note === null) continue;
          const sides = [...note.body.matchAll(EQUATION)];
          // Every "=" in an explanation is an equation this test can read.
          expect(sides.length, `${stop.stop}: ${note.body}`).toBe(
            (note.body.match(/=/g) ?? []).length,
          );
          for (const [, left = "", right = ""] of sides) {
            const target = plain(right, locale);
            const places = target.split(".")[1]?.length ?? 0;
            expect(
              evaluate(left, locale).toPlain(places, "halfUp"),
              `${stop.stop}: ${left} = ${right}`,
            ).toBe(Decimal.parse(target).toPlain(places, "halfUp"));
            checked += 1;
          }
        }
      }
      // The holding rates, the sale's rate, the slices, the holiday dividend, the treaty.
      expect(checked).toBeGreaterThanOrEqual(5);
    });
  }
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
    const covered = new Set<string>(demoPreview.files.map((f) => f.broker));
    for (const [, t] of LOCALES) {
      // Every broker the app knows that has no file in the demo, and the
      // ones it does not support yet.
      const others = [
        ...Object.entries(t.brokers)
          .filter(([id]) => !covered.has(id))
          .map(([, name]) => name),
        "Schwab",
        "eToro",
        "Revolut",
      ];
      expect(others.length).toBeGreaterThan(3);
      const said = sayings(t).toLowerCase();
      for (const name of others) expect(said).not.toContain(name.toLowerCase());
      expect(said).not.toMatch(/in your case|v vašem primeru/);
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
      /cssText|setAttribute\(\s*["'`]style["'`]|setAttributeNS\([^)]*["'`]style["'`]|createElement\(\s*["'`]style["'`]|<style[\s>]|\.style\s*=[^=]|\sstyle="/;
    for (const [path, source] of files) {
      expect(code(source), path).not.toMatch(banned);
    }
  });
});
