/**
 * Holding periods and the capital-gains rate they lead to (ZDoh-2 Arts. 96
 * and 132; docs/research/04-si-tax-rules.md §2.1, §4.5): 25% under five
 * completed years, 20% after five, 15% after ten, and exempt after fifteen,
 * when the lot is not listed on the return at all.
 */
import { isIsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import type { IsoDate } from "./ledger.js";

export const HOLDING_BUCKETS = Object.freeze(["25", "20", "15", "0"] as const);
export type HoldingBucket = (typeof HOLDING_BUCKETS)[number];

/** Each bucket's rate as a fraction. */
export const BUCKET_RATES: Readonly<Record<HoldingBucket, Decimal>> =
  Object.freeze({
    "25": Decimal.parse("0.25"),
    "20": Decimal.parse("0.20"),
    "15": Decimal.parse("0.15"),
    "0": Decimal.ZERO,
  });

/**
 * Whole years from acquisition to disposal: "po dopolnjenih petih letih",
 * after five completed years. The anniversary itself completes a year; FURS
 * publishes no example of that boundary day (research 04, open questions).
 */
export function completedYears(acquired: IsoDate, disposed: IsoDate): number {
  const [ay, am, ad] = acquired.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [dy, dm, dd] = disposed.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return dy - ay - (dm < am || (dm === am && dd < ad) ? 1 : 0);
}

export function bucketFor(years: number): HoldingBucket {
  return years >= 15 ? "0" : years >= 10 ? "15" : years >= 5 ? "20" : "25";
}

/** Days between two ISO dates, positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  );
}

/** The ISO date `days` after (or before, when negative) `date`. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** The completed years at which the rate falls: to 20%, to 15%, to 0%. */
const BUCKET_YEARS = Object.freeze([5, 10, 15] as const);

/** Where a lot still held stands, for planning its sale. */
export interface HoldingOutlook {
  /** The bucket a sale on the as-of day falls in, read cautiously. */
  readonly bucket: HoldingBucket;
  /** The next, lower bucket and the first day it is certain; null once exempt. */
  readonly next: {
    readonly bucket: HoldingBucket;
    readonly from: IsoDate;
  } | null;
}

/**
 * Where a lot held on `asOf` stands. A day counts as in a bucket only when
 * it is there under either reading of the anniversary: `completedYears` lets
 * the anniversary itself complete the year, and FURS has published no
 * example of that day (research 04 §4.5 and its open questions). So the
 * date given is the day after the anniversary, and on the anniversary the
 * lot still shows the higher rate: a sale planned from it is never one day
 * early, at five points more tax. The returns use `completedYears` as is.
 */
export function holdingOutlook(
  acquired: IsoDate,
  asOf: IsoDate,
): HoldingOutlook {
  const years = completedYears(acquired, addDays(asOf, -1));
  const bucket = bucketFor(years);
  const target = BUCKET_YEARS.find((y) => y > years);
  if (target === undefined) return { bucket, next: null };
  return {
    bucket,
    next: {
      bucket: bucketFor(target),
      from: addDays(anniversary(acquired, target), 1),
    },
  };
}

/**
 * The first day `completedYears` counts `years` complete: the anniversary,
 * or 1 March for a 29 February outside a leap year.
 */
function anniversary(acquired: IsoDate, years: number): IsoDate {
  const year = String(Number(acquired.slice(0, 4)) + years).padStart(4, "0");
  const date = `${year}${acquired.slice(4)}`;
  return isIsoDate(date) ? date : `${year}-03-01`;
}
