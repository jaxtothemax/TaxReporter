/**
 * The gains-tax estimate shown next to the return. eDavki computes the real
 * tax; this mirrors its rules so the user is not surprised (ZDoh-2 Art. 97;
 * docs/research/04-si-tax-rules.md §4.1, §4.6, §5):
 *
 * - per lot: gain = disposal value − acquisition value; normed costs of 1%
 *   of each, only on a gain and never more than the gain;
 * - a loss the 30-day rule disallows counts as zero;
 * - losses offset gains of the same year only, never carried forward;
 * - the net positive base is split across holding-period buckets in
 *   proportion to each bucket's positive base, then taxed at its rate.
 */
import { Decimal } from "./decimal.js";
import {
  BUCKET_RATES,
  HOLDING_BUCKETS,
  type HoldingBucket,
} from "./holding.js";

const ONE_PERCENT = Decimal.parse("0.01");

export interface EstimateLot {
  readonly bucket: HoldingBucket;
  /** Acquisition value in EUR, already rounded to cents as eDavki does. */
  readonly acquisitionEur: Decimal;
  /** Disposal value in EUR, already rounded to cents. */
  readonly disposalEur: Decimal;
  /** False when the 30-day rule disallows (or may disallow) the loss. */
  readonly lossReducesBase: boolean;
}

export interface LotBase {
  readonly gain: Decimal;
  readonly normedCosts: Decimal;
  /** The lot's contribution to the base: gain less costs, or zero for a disallowed loss. */
  readonly base: Decimal;
}

export function lotBase(lot: EstimateLot): LotBase {
  const gain = lot.disposalEur.minus(lot.acquisitionEur);
  if (!gain.isPositive()) {
    return {
      gain,
      normedCosts: Decimal.ZERO,
      base: lot.lossReducesBase ? gain : Decimal.ZERO,
    };
  }
  const flat = ONE_PERCENT.times(
    lot.acquisitionEur.plus(lot.disposalEur),
  ).round(2, "halfUp");
  const normedCosts = flat.lessThan(gain) ? flat : gain;
  return { gain, normedCosts, base: gain.minus(normedCosts) };
}

export interface GainsEstimate {
  readonly positiveByBucket: Readonly<Record<HoldingBucket, Decimal>>;
  /** The year's losses that may reduce the base (zero or negative). */
  readonly losses: Decimal;
  /** Positive bases plus losses, not below zero. */
  readonly netBase: Decimal;
  readonly allocatedByBucket: Readonly<Record<HoldingBucket, Decimal>>;
  /** Exact; round it at display. */
  readonly tax: Decimal;
}

function byBucket(value: (bucket: HoldingBucket) => Decimal) {
  return Object.fromEntries(
    HOLDING_BUCKETS.map((bucket) => [bucket, value(bucket)]),
  ) as Record<HoldingBucket, Decimal>;
}

export function estimateGainsTax(lots: readonly EstimateLot[]): GainsEstimate {
  // Lots held 15 years or more are exempt and left off the return entirely;
  // their losses reduce nothing either (Art. 96(3)).
  const taxable = lots.filter((lot) => lot.bucket !== "0");
  const bases = taxable.map((lot) => ({ bucket: lot.bucket, ...lotBase(lot) }));
  const positiveByBucket = byBucket((bucket) =>
    Decimal.sum(
      bases
        .filter((b) => b.bucket === bucket && b.base.isPositive())
        .map((b) => b.base),
    ),
  );
  const losses = Decimal.sum(
    bases.filter((b) => b.base.isNegative()).map((b) => b.base),
  );
  const totalPositive = Decimal.sum(Object.values(positiveByBucket));
  const net = totalPositive.plus(losses);
  const netBase = net.isPositive() ? net : Decimal.ZERO;
  const allocatedByBucket = byBucket((bucket) =>
    totalPositive.isZero()
      ? Decimal.ZERO
      : netBase.times(positiveByBucket[bucket]).dividedBy(totalPositive),
  );
  const tax = Decimal.sum(
    HOLDING_BUCKETS.map((bucket) =>
      allocatedByBucket[bucket].times(BUCKET_RATES[bucket]),
    ),
  );
  return { positiveByBucket, losses, netBase, allocatedByBucket, tax };
}
