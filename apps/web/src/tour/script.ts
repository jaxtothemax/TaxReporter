/**
 * The guided tour's stops over the demo (#27, ADR 0016): for each, the view
 * it shows, the element it lights, and up to three explanations, each tied to
 * an element by its anchor. Every figure an explanation names is a field of
 * the preview, formatted as the screen formats it, never filled in by hand.
 * An explanation whose figures the preview lacks returns null rather than
 * guess one. That is a guard on the script, not a state the tour shows: the
 * tour runs only on the demo's preview, where tour.test.tsx requires every
 * explanation to render, and the layer counts and measures explanations by
 * position (NOTE_COUNTS), so a null one would leave an empty step.
 */
import { demoPreview } from "../demo/demoPreview";
import {
  findingKey,
  path,
  type AnchorPath,
  type PathStep,
} from "../explain/anchors";
import {
  formatCountry,
  formatDate,
  formatEur,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
  plural,
  type Locale,
} from "../i18n/format";
import type { Messages } from "../i18n/messages";
import { findingText } from "../i18n/present";
import {
  formFileName,
  HOLDING_BUCKETS,
  type DividendRow,
  type KdvpRow,
  type ReturnPreview,
  type SecurityResult,
} from "../model/preview";
import type { ReviewView } from "../screens/ReviewStep";
import type { FlowStep } from "../state/wizard";
import { bucketLabel } from "../ui/bits";

/** The demo's Apple shares: a split, a USD sale, two lots in two buckets. */
export const DEMO_AAPL = "US0378331005";
/** NVIDIA: bought at Trading 212 and at IBKR, sold at IBKR. */
export const DEMO_NVDA = "US67066G1040";
/** VWCE: small euro buys at Trading 212, one sale using four of them. */
export const DEMO_VWCE = "IE00BK5BQT80";
/** ASML: one purchase, one sale at a loss. */
export const DEMO_ASML = "NL0010273215";
/** AT&T's dividend paid on 1 May 2026, a TARGET holiday. */
export const DEMO_HOLIDAY = {
  isin: "US00206R1023",
  date: "2026-05-01",
} as const;
/** Allianz's dividend, withheld above the treaty rate. */
export const DEMO_TREATY = {
  isin: "DE0008404005",
  date: "2026-05-08",
} as const;

/** Joins an operation's two sides so a line never breaks inside it. */
const NBSP = "\u00a0";
export const times = (a: string, b: string) => `${a}${NBSP}×${NBSP}${b}`;
export const divided = (a: string, b: string) => `${a}${NBSP}÷${NBSP}${b}`;

export interface TextContext {
  readonly t: Messages;
  readonly locale: Locale;
  readonly preview: ReturnPreview;
}

export interface NoteText {
  /** The target's visible name, as the screen shows it. */
  readonly lead: string;
  readonly body: string;
  /** Whether the lead is an identifier the screen sets in monospace. */
  readonly mono?: boolean;
}

export interface TourNote {
  readonly target: AnchorPath;
  readonly text: (context: TextContext) => NoteText | null;
}

export type StopId =
  | "files"
  | "details"
  | "summary"
  | "saleRate"
  | "holding"
  | "fifoBrokers"
  | "slices"
  | "loss"
  | "holiday"
  | "treaty"
  | "notes"
  | "download";

export interface TourStop {
  readonly id: StopId;
  /** What the stop shows, over the user's own view. */
  readonly view: { readonly screen: FlowStep; readonly review?: ReviewView };
  /** The elements left lit; one cutout covers them all. */
  readonly focus: readonly AnchorPath[];
  /** Space around the lit elements: less for a table row. */
  readonly pad: number;
  readonly prefer: "gutter" | "row";
  readonly title: (context: TextContext) => string;
  readonly intro: (context: TextContext) => string;
  readonly notes: readonly [TourNote, ...TourNote[]];
}

const review = (open: readonly string[] = []): ReviewView => ({
  tab: "gains",
  open: new Set(open),
});

const security = (
  preview: ReturnPreview,
  isin: string,
): SecurityResult | null =>
  preview.securities.find((s) => s.isin === isin) ?? null;

const rowKey = (row: KdvpRow) => `${row.kind}@${row.date}`;

const firstSale = (s: SecurityResult | null) =>
  s?.rows.find((row) => row.kind === "sale") ?? null;

const splitRow = (s: SecurityResult | null) =>
  s?.rows.find((row) => row.splitAdjusted !== undefined) ?? null;

const purchases = (s: SecurityResult | null) =>
  s?.rows.filter((row) => row.kind === "purchase") ?? [];

const purchaseOn = (s: SecurityResult | null, date: string) =>
  purchases(s).find((row) => row.date === date) ?? null;

const quantity = (value: string, locale: Locale) =>
  formatNumber(value, locale, { maxFraction: 8 });

/** "A and B", in the language's own way. */
const listOf = (locale: Locale, items: readonly string[]) =>
  new Intl.ListFormat(locale, { type: "conjunction" }).format([
    ...new Set(items),
  ]);

const dividendAt = (
  preview: ReturnPreview,
  at: { readonly isin: string; readonly date: string },
): DividendRow | null =>
  preview.dividends.find((d) => d.isin === at.isin && d.date === at.date) ??
  null;

const dividendKey = (at: { readonly isin: string; readonly date: string }) =>
  `${at.isin}@${at.date}`;

const isWeekday = (iso: string) => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

const DAY_MS = 86_400_000;
const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  DAY_MS;

const secRow = (isin: string, row: KdvpRow | null, ...rest: PathStep[]) =>
  path(
    ["sec.item", isin],
    ["sec.row", row === null ? "" : rowKey(row)],
    ...rest,
  );

const lotRow = (isin: string, date: string | undefined, ...rest: PathStep[]) =>
  path(["sec.item", isin], ["lot.row", date ?? ""], ...rest);

/** A demo file's explanation: its name, and from when its rows run. */
function fileNote(
  index: number,
  body: (t: Messages) => (broker: string, date: string) => string,
): TourNote {
  return {
    target: path(["files.text", fileName(index)]),
    text: ({ t, locale, preview }) => {
      const file = preview.files[index];
      if (file === undefined) return null;
      return {
        lead: file.name,
        mono: true,
        body: body(t)(
          t.brokers[file.broker],
          formatDate(file.firstDate, locale),
        ),
      };
    },
  };
}

// The demo's file names, read from the preview the tour is written for.
const fileName = (index: number) => demoPreview.files[index]?.name ?? "";
const aaplSale = firstSale(security(demoPreview, DEMO_AAPL));
const aaplSplit = splitRow(security(demoPreview, DEMO_AAPL));
const lotDate = (isin: string, index: number) =>
  security(demoPreview, isin)?.lots[index]?.purchaseDate;
const nvdaOldest = purchases(security(demoPreview, DEMO_NVDA))[0] ?? null;
const nvdaSale = firstSale(security(demoPreview, DEMO_NVDA));
/** The lot a sale used only in part: the purchase it came from was larger. */
const partLot = (s: SecurityResult | null) =>
  s?.lots.find((lot) => {
    const bought = purchaseOn(s, lot.purchaseDate);
    return bought !== null && bought.quantity !== lot.quantity;
  }) ?? null;
const interestFinding = demoPreview.findings.find(
  (f) => f.code === "interestNotCovered",
);
const aaplRow = (row: KdvpRow | null, ...rest: PathStep[]) =>
  path(
    ["sec.item", DEMO_AAPL],
    ["sec.row", row === null ? "" : rowKey(row)],
    ...rest,
  );

export const TOUR: readonly TourStop[] = [
  {
    id: "files",
    view: { screen: "files" },
    focus: [path("files.list")],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.files.title,
    intro: ({ t }) => t.tour.stops.files.intro,
    notes: [
      fileNote(0, (t) => t.explain.wholeHistory),
      fileNote(1, (t) => t.explain.fifoAcrossBrokers),
    ],
  },
  {
    id: "details",
    view: { screen: "details" },
    focus: [path("details.form")],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.details.title,
    intro: ({ t }) => t.tour.stops.details.intro,
    notes: [
      {
        target: path("details.taxNumber"),
        text: ({ t }) => ({
          lead: t.details.taxNumberLabel,
          body: t.explain.taxNumberInHeader,
        }),
      },
    ],
  },
  {
    id: "summary",
    view: { screen: "review", review: review() },
    focus: [path("summary.gainsTax")],
    pad: 8,
    prefer: "gutter",
    title: ({ t }) => t.tour.stops.summary.title,
    intro: ({ t }) => t.tour.stops.summary.intro,
    notes: [
      {
        target: path("summary.estimateChip"),
        text: ({ t }) => ({
          lead: t.review.estimateChip,
          body: t.explain.estimateOnly,
        }),
      },
      {
        target: path("summary.netBase"),
        text: ({ t, locale, preview }) => ({
          lead: `${t.review.netBase} ${formatEur(preview.gainsEstimate.netBaseEur, locale)}`,
          body: t.explain.netTaxableGain(
            formatEur(preview.gainsEstimate.lossesEur, locale, {
              signed: true,
            }),
          ),
        }),
      },
      {
        target: path("summary.buckets"),
        text: ({ t, locale, preview }) => {
          const { allocatedByBucket, taxEur } = preview.gainsEstimate;
          const terms = HOLDING_BUCKETS.filter(
            (b) => allocatedByBucket[b] !== "0.00",
          ).map((b) =>
            times(
              formatEur(allocatedByBucket[b], locale),
              bucketLabel(b, locale),
            ),
          );
          if (terms.length === 0) return null;
          return {
            lead: t.review.bucketsTitle,
            body: t.explain.holdingBucket(
              terms.join(" + "),
              formatEur(taxEur, locale),
            ),
          };
        },
      },
    ],
  },
  {
    id: "saleRate",
    view: { screen: "review", review: review([DEMO_AAPL]) },
    focus: [path(["sec.item", DEMO_AAPL], "sec.rows")],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.saleRate.title,
    intro: ({ t, preview }) =>
      t.tour.stops.saleRate.intro(
        security(preview, DEMO_AAPL)?.name ?? DEMO_AAPL,
      ),
    notes: [
      {
        target: aaplRow(aaplSplit, "sec.split"),
        text: ({ t, locale, preview }) => {
          const split = splitRow(security(preview, DEMO_AAPL))?.splitAdjusted;
          if (split === undefined) return null;
          return {
            lead: t.review.splitNote(
              split.ratio,
              formatDate(split.date, locale),
            ),
            body: t.explain.splitAdjusted(split.ratio),
          };
        },
      },
      {
        target: aaplRow(aaplSale, "sec.rate"),
        text: ({ t, locale, preview }) => {
          const sale = firstSale(security(preview, DEMO_AAPL));
          const rate = sale?.rate ?? null;
          // Only a daily list is explained here; a monthly rate or the euro's
          // changeover rate would need words of its own (research 03 §5, §10).
          if (sale === null || rate === null || rate.source !== "bsi-daily")
            return null;
          const division = divided(
            formatMoney(sale.price.amount, sale.price.currency, locale),
            formatRate(rate.rate, locale),
          );
          const perUnit = formatNumber(sale.priceEur, locale, {
            minFraction: 2,
            maxFraction: 8,
          });
          return {
            lead: t.review.rate(formatRate(rate.rate, locale), rate.currency),
            body:
              rate.listDate === sale.date
                ? t.explain.bsiRateTradeDay(
                    formatDate(rate.listDate, locale),
                    rate.currency,
                    division,
                    perUnit,
                  )
                : t.explain.bsiRateListBefore(
                    formatDate(sale.date, locale),
                    formatDate(rate.listDate, locale),
                    rate.currency,
                    division,
                    perUnit,
                  ),
          };
        },
      },
      {
        target: aaplRow(aaplSale, "sec.source"),
        text: ({ t, preview }) => {
          const sale = firstSale(security(preview, DEMO_AAPL));
          if (sale === null) return null;
          return {
            lead: t.review.source(sale.source.file, String(sale.source.row)),
            mono: true,
            body: t.explain.sourceRow,
          };
        },
      },
    ],
  },
  {
    id: "holding",
    view: { screen: "review", review: review([DEMO_AAPL]) },
    focus: [path(["sec.item", DEMO_AAPL], "sec.lots")],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.holding.title,
    intro: ({ t, locale, preview }) =>
      t.tour.stops.holding.intro(
        quantity(security(preview, DEMO_AAPL)?.quantitySold ?? "0", locale),
      ),
    notes: [
      {
        target: lotRow(DEMO_AAPL, lotDate(DEMO_AAPL, 0), "lot.bucket"),
        text: ({ t, locale, preview }) => {
          const lot = security(preview, DEMO_AAPL)?.lots[0];
          if (lot === undefined) return null;
          return {
            lead: bucketLabel(lot.bucket, locale),
            body: t.explain.holdingSchedule(
              plural(lot.yearsHeld, locale, t.review.years),
              formatDate(lot.purchaseDate, locale),
              bucketLabel("25", locale),
              bucketLabel("20", locale),
              bucketLabel("15", locale),
              bucketLabel("0", locale),
            ),
          };
        },
      },
      {
        target: lotRow(DEMO_AAPL, lotDate(DEMO_AAPL, 1), "lot.bucket"),
        text: ({ t, locale, preview }) => {
          const s = security(preview, DEMO_AAPL);
          const [first, second, ...more] = s?.lots ?? [];
          if (first === undefined || second === undefined || more.length > 0) {
            return null;
          }
          const bought = purchaseOn(s, second.purchaseDate);
          if (bought === null) return null;
          return {
            lead: bucketLabel(second.bucket, locale),
            body: t.explain.fifoTwoLots(
              quantity(first.quantity, locale),
              formatDate(first.purchaseDate, locale),
              quantity(second.quantity, locale),
              quantity(bought.quantity, locale),
              formatDate(second.purchaseDate, locale),
            ),
          };
        },
      },
    ],
  },
  {
    id: "fifoBrokers",
    view: { screen: "review", review: review([DEMO_NVDA]) },
    focus: [path(["sec.item", DEMO_NVDA], "sec.rows")],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.fifoBrokers.title,
    intro: ({ t, locale, preview }) => {
      const s = security(preview, DEMO_NVDA);
      const sale = firstSale(s);
      return t.tour.stops.fifoBrokers.intro(
        s?.name ?? DEMO_NVDA,
        listOf(
          locale,
          purchases(s).map((row) => t.brokers[row.broker]),
        ),
        sale === null ? "" : t.brokers[sale.broker],
      );
    },
    notes: [
      {
        target: secRow(DEMO_NVDA, nvdaOldest, "sec.source"),
        text: ({ t, locale, preview }) => {
          const s = security(preview, DEMO_NVDA);
          const oldest = purchases(s)[0];
          const sale = firstSale(s);
          // Only where the oldest purchase is at another broker than the sale.
          if (
            oldest === undefined ||
            sale === null ||
            oldest.broker === sale.broker
          ) {
            return null;
          }
          return {
            lead: t.brokers[oldest.broker],
            body: t.explain.oldestFromOtherBroker(
              quantity(oldest.quantity, locale),
              formatDate(oldest.date, locale),
              t.brokers[oldest.broker],
              t.brokers[sale.broker],
            ),
          };
        },
      },
      {
        target: secRow(DEMO_NVDA, nvdaSale, "sec.quantity"),
        text: ({ t, locale, preview }) => {
          const s = security(preview, DEMO_NVDA);
          const sale = firstSale(s);
          const [first, second, ...more] = s?.lots ?? [];
          if (
            sale === null ||
            first === undefined ||
            second === undefined ||
            more.length > 0
          ) {
            return null;
          }
          const from = purchaseOn(s, first.purchaseDate);
          const then = purchaseOn(s, second.purchaseDate);
          if (from === null || then === null) return null;
          return {
            lead: quantity(sale.quantity, locale),
            body: t.explain.soldAcrossBrokers(
              formatDate(sale.date, locale),
              quantity(first.quantity, locale),
              t.brokers[from.broker],
              quantity(second.quantity, locale),
              quantity(then.quantity, locale),
              t.brokers[then.broker],
              formatDate(then.date, locale),
            ),
          };
        },
      },
    ],
  },
  {
    id: "slices",
    view: { screen: "review", review: review([DEMO_VWCE]) },
    focus: [path(["sec.item", DEMO_VWCE], "sec.lots")],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.slices.title,
    intro: ({ t, locale, preview }) => {
      const s = security(preview, DEMO_VWCE);
      const broker = purchases(s)[0]?.broker;
      return t.tour.stops.slices.intro(
        broker === undefined ? "" : t.brokers[broker],
        quantity(s?.quantitySold ?? "0", locale),
      );
    },
    notes: [
      {
        target: lotRow(DEMO_VWCE, lotDate(DEMO_VWCE, 0), "lot.bought"),
        text: ({ t, locale, preview }) => {
          const s = security(preview, DEMO_VWCE);
          const lots = s?.lots ?? [];
          const first = lots[0];
          if (s === null || first === undefined) return null;
          return {
            lead: formatDate(first.purchaseDate, locale),
            body: t.explain.fifoSlices(
              lots.map((lot) => quantity(lot.quantity, locale)).join(" + "),
              quantity(s.quantitySold, locale),
            ),
          };
        },
      },
      {
        target: lotRow(
          DEMO_VWCE,
          partLot(security(demoPreview, DEMO_VWCE))?.purchaseDate,
          "lot.quantity",
        ),
        text: ({ t, locale, preview }) => {
          const s = security(preview, DEMO_VWCE);
          const lot = partLot(s);
          const bought = lot === null ? null : purchaseOn(s, lot.purchaseDate);
          if (lot === null || bought === null) return null;
          return {
            lead: quantity(lot.quantity, locale),
            body: t.explain.partialLot(
              quantity(lot.quantity, locale),
              quantity(bought.quantity, locale),
              formatDate(lot.purchaseDate, locale),
            ),
          };
        },
      },
    ],
  },
  {
    id: "loss",
    view: { screen: "review", review: review([DEMO_ASML]) },
    focus: [path(["sec.item", DEMO_ASML], "sec.summary")],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.loss.title,
    intro: ({ t }) => t.tour.stops.loss.intro,
    notes: [
      {
        target: path(["sec.item", DEMO_ASML], "sec.symbol"),
        text: ({ t, locale, preview }) => {
          const s = security(preview, DEMO_ASML);
          const sale = firstSale(s);
          const bought = purchases(s)[0];
          if (s === null || sale === null || bought === undefined) return null;
          // Said only where it holds in these files: a loss, and no purchase
          // of the same security within 30 days of the sale (research 04 §5.3).
          const replaced = purchases(s).some(
            (row) => daysApart(row.date, sale.date) <= 30,
          );
          if (!s.gainEur.startsWith("-") || replaced) return null;
          return {
            lead: s.symbol,
            body: t.explain.lossWithin30Days(
              formatDate(bought.date, locale),
              formatDate(sale.date, locale),
            ),
          };
        },
      },
      {
        target: path(["sec.item", DEMO_ASML], "sec.gain"),
        text: ({ t, locale, preview }) => {
          const s = security(preview, DEMO_ASML);
          if (s === null || !s.gainEur.startsWith("-")) return null;
          return {
            lead: formatEur(s.gainEur, locale, { signed: true }),
            body: t.explain.lossOffsets(
              formatEur(s.proceedsEur, locale),
              formatEur(s.costEur, locale),
            ),
          };
        },
      },
    ],
  },
  {
    id: "holiday",
    view: { screen: "review", review: { tab: "dividends", open: new Set() } },
    focus: [path(["div.row", dividendKey(DEMO_HOLIDAY)])],
    pad: 4,
    prefer: "row",
    title: ({ t }) => t.tour.stops.holiday.title,
    intro: ({ t }) => t.tour.stops.holiday.intro,
    notes: [
      {
        target: path(["div.row", dividendKey(DEMO_HOLIDAY)], "div.gross"),
        text: ({ t, locale, preview }) => {
          const d = dividendAt(preview, DEMO_HOLIDAY);
          if (d === null || d.rate === null) return null;
          return {
            lead: formatEur(d.grossEur, locale),
            body: t.explain.amountInEur(
              divided(
                formatMoney(d.gross.amount, d.gross.currency, locale),
                formatRate(d.rate.rate, locale),
              ),
              formatEur(d.grossEur, locale),
            ),
          };
        },
      },
      {
        target: path(["div.row", dividendKey(DEMO_HOLIDAY)], "div.rate"),
        text: ({ t, locale, preview }) => {
          const d = dividendAt(preview, DEMO_HOLIDAY);
          const rate = d?.rate ?? null;
          // A holiday only: a weekday with no list, and an earlier list used.
          if (
            d === null ||
            rate === null ||
            rate.listDate >= d.date ||
            !isWeekday(d.date)
          ) {
            return null;
          }
          return {
            lead: t.review.rate(formatRate(rate.rate, locale), rate.currency),
            body: t.explain.listBeforeHoliday(
              formatDate(d.date, locale),
              formatDate(rate.listDate, locale),
            ),
          };
        },
      },
    ],
  },
  {
    id: "treaty",
    view: { screen: "review", review: { tab: "dividends", open: new Set() } },
    focus: [path(["div.row", dividendKey(DEMO_TREATY)])],
    pad: 4,
    prefer: "row",
    title: ({ t }) => t.tour.stops.treaty.title,
    intro: ({ t }) => t.tour.stops.treaty.intro,
    notes: [
      {
        target: path(["div.row", dividendKey(DEMO_TREATY)], "div.foreignTax"),
        text: ({ t, locale, preview }) => {
          const d = dividendAt(preview, DEMO_TREATY);
          if (d === null) return null;
          return {
            lead: formatEur(d.foreignTaxEur, locale),
            body: t.explain.foreignTaxWithheld(
              formatCountry(d.country, locale),
              formatEur(d.grossEur, locale),
              d.payer,
            ),
          };
        },
      },
      {
        target: path(["div.row", dividendKey(DEMO_TREATY)], "div.credit"),
        text: ({ t, locale, preview }) => {
          const d = dividendAt(preview, DEMO_TREATY);
          const excess = preview.findings.find(
            (f) =>
              f.code === "excessWithholding" &&
              f.params["isin"] === DEMO_TREATY.isin,
          )?.params["excessEur"];
          if (d === null || d.treatyRate === null || typeof excess !== "string")
            return null;
          const rate = formatPercent(d.treatyRate, locale);
          return {
            lead: formatEur(d.creditEur, locale),
            body: t.explain.treatyCappedCredit(
              formatCountry(d.country, locale),
              rate,
              `${times(formatEur(d.grossEur, locale), rate)} = ${formatEur(d.creditEur, locale)}`,
              formatEur(excess, locale),
            ),
          };
        },
      },
    ],
  },
  {
    id: "notes",
    view: { screen: "review", review: { tab: "notes", open: new Set() } },
    focus: [path("notes.noneBlocking"), path(["notes.group", "warning"])],
    pad: 8,
    prefer: "row",
    title: ({ t }) => t.tour.stops.notes.title,
    intro: ({ t }) => t.tour.stops.notes.intro,
    notes: [
      {
        target: path("notes.noneBlocking"),
        text: ({ t, preview }) => {
          if (preview.findings.some((f) => f.severity === "blocking"))
            return null;
          return {
            lead: t.review.noneBlocking,
            body: t.explain.findingSeverity(
              t.review.severity.blocking,
              t.review.severity.warning,
              t.review.severity.info,
            ),
          };
        },
      },
      {
        target: path(
          ["notes.group", "warning"],
          [
            "notes.item",
            interestFinding === undefined ? "" : findingKey(interestFinding),
          ],
        ),
        text: ({ t, locale, preview }) => {
          const finding = preview.findings.find(
            (f) => f.code === "interestNotCovered",
          );
          if (finding === undefined) return null;
          const said = findingText(finding, {
            locale,
            symbols: preview.symbols,
            fileName: (file) => preview.files[file]?.name ?? "",
          });
          // The note's first sentence names what it is about.
          const [first = said] = said.split(/(?<=\.)\s/);
          return { lead: first, body: t.explain.notOnTheseReturns };
        },
      },
    ],
  },
  {
    id: "download",
    view: { screen: "download" },
    focus: [path(["download.form", "kdvp"])],
    pad: 8,
    prefer: "gutter",
    title: ({ t }) => t.tour.stops.download.title,
    intro: ({ t }) => t.tour.stops.download.intro,
    notes: [
      {
        target: path(["download.title", "kdvp"]),
        text: ({ t }) => ({
          lead: t.download.kdvpTitle,
          body: t.explain.returnForms,
        }),
      },
      {
        target: path(["download.fileName", "kdvp"]),
        text: ({ t, preview }) => ({
          lead: formFileName("kdvp", preview.taxYear),
          mono: true,
          body: t.explain.edavkiImport,
        }),
      },
      {
        target: path(["download.button", "kdvp"]),
        text: ({ t }) => ({
          lead: t.download.downloadButton(t.download.kdvpTitle),
          body: t.explain.youReviewAndSubmit,
        }),
      },
    ],
  },
];

/** How many explanations each stop holds, for the tour's reducer. */
export const NOTE_COUNTS: readonly number[] = TOUR.map(
  (stop) => stop.notes.length,
);
