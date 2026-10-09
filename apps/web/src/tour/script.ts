/**
 * The guided tour's stops over the demo (#27, ADR 0016): for each, the view
 * it shows, the element it lights, and up to three explanations, each tied to
 * an element by its anchor. Every figure an explanation names is a field of
 * the preview, formatted as the screen formats it; an explanation whose
 * figures the preview lacks is left out (null), never filled in by hand.
 */
import { demoPreview } from "../demo/demoPreview";
import { path, type AnchorPath, type PathStep } from "../explain/anchors";
import {
  formatDate,
  formatEur,
  formatMoney,
  formatNumber,
  formatRate,
  type Locale,
} from "../i18n/format";
import type { Messages } from "../i18n/messages";
import {
  HOLDING_BUCKETS,
  type KdvpRow,
  type ReturnPreview,
  type SecurityResult,
} from "../model/preview";
import type { ReviewView } from "../screens/ReviewStep";
import type { FlowStep } from "../state/wizard";
import { bucketLabel } from "../ui/bits";

/** The demo's Apple shares: a split, a USD sale, two lots in two buckets. */
export const DEMO_AAPL = "US0378331005";

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

export type StopId = "files" | "summary" | "saleRate" | "download";

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
          // changeover rate would need words of its own (research 03 §9, §11).
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
          lead: `Doh_KDVP_${String(preview.taxYear)}.xml`,
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
