/**
 * The 30-day rule (pravilo navidezne odsvojitve, ZDoh-2 Art. 97(5)): a loss
 * does not reduce the tax base when the taxpayer acquires the same kind of
 * capital within 30 days before or after the sale. The FURS reading this
 * follows (docs/research/04-si-tax-rules.md §5.3):
 *
 * - the window is 61 days, the sale day plus 30 on each side;
 * - replacement is measured by quantity, and only the replaced part of the
 *   loss is disallowed;
 * - loss sales are taken in date order, and each acquisition can replace
 *   only once;
 * - the lots a sale consumes, including the unsold rest of a lot it sells
 *   from, are never its own replacement (so selling the whole position,
 *   window purchases included, keeps the whole loss).
 *
 * Whether a sale is a loss depends on EUR values, so the caller decides that
 * and passes the loss sales in. Family members and companies the taxpayer
 * holds 25% of are the other trigger of the rule; broker data cannot show
 * them, so the app has to ask.
 */
import { Decimal } from "./decimal.js";
import type { Disposal, SecurityHistory } from "./fifo.js";
import { addDays } from "./holding.js";
import type { IsoDate, SplitEvent } from "./ledger.js";

export const WASH_SALE_DAYS = 30;

export type WashSaleStatus =
  /** No replacement: the whole loss may reduce the base (F10 true). */
  | "allowed"
  /** Fully replaced: the loss does not reduce the base (F10 false). */
  | "disallowed"
  /** Partly replaced: `replaced` of the quantity is disallowed. */
  | "partial"
  /**
   * The imported files end before the window does, so a later purchase
   * could still replace it; F10 is left out until it can be decided.
   */
  | "undetermined";

export interface WashSaleVerdict {
  readonly status: WashSaleStatus;
  /** Replaced quantity, in shares as of the sale date. */
  readonly replaced: Decimal;
}

/** Shares on `to` per share on `from`, for the splits in between. */
function factorBetween(
  splits: readonly SplitEvent[],
  from: IsoDate,
  to: IsoDate,
): Decimal {
  let factor = Decimal.ONE;
  for (const split of splits) {
    if (from < split.date && split.date <= to) {
      factor = factor.times(split.to.dividedBy(split.from));
    }
  }
  return factor;
}

/** A purchase's quantity expressed in shares as of `date`. */
function inSharesOf(
  splits: readonly SplitEvent[],
  quantity: Decimal,
  purchased: IsoDate,
  date: IsoDate,
): Decimal {
  return purchased <= date
    ? quantity.times(factorBetween(splits, purchased, date))
    : quantity.dividedBy(factorBetween(splits, date, purchased));
}

/**
 * Verdicts for the loss sales of one security, keyed by the sale's event
 * key. `lossSales` are disposals the caller found to be losses; the order
 * they are given in does not matter.
 */
export function washSaleVerdicts(
  history: SecurityHistory,
  lossSales: readonly Disposal[],
  coverageEnd: IsoDate,
): ReadonlyMap<string, WashSaleVerdict> {
  const purchases = [...history.purchases].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  // Replacement capacity left per purchase, in that purchase's own shares.
  const capacity = new Map<string, Decimal>(
    purchases.map((p) => [p.key, p.quantity]),
  );
  const verdicts = new Map<string, WashSaleVerdict>();
  const ordered = [...lossSales].sort((a, b) =>
    a.sale.date.localeCompare(b.sale.date),
  );

  for (const disposal of ordered) {
    const sale = disposal.sale;
    const own = new Set(disposal.matches.map((m) => m.purchase.key));
    const first = addDays(sale.date, -WASH_SALE_DAYS);
    const last = addDays(sale.date, WASH_SALE_DAYS);
    let need = sale.quantity;
    let replaced = Decimal.ZERO;
    for (const purchase of purchases) {
      if (!need.isPositive()) break;
      if (purchase.date < first || purchase.date > last) continue;
      if (own.has(purchase.key)) continue;
      const left = capacity.get(purchase.key) ?? Decimal.ZERO;
      if (!left.isPositive()) continue;
      const available = inSharesOf(
        history.splits,
        left,
        purchase.date,
        sale.date,
      );
      const take = available.lessThan(need) ? available : need;
      replaced = replaced.plus(take);
      need = need.minus(take);
      capacity.set(
        purchase.key,
        left.minus(inSharesOf(history.splits, take, sale.date, purchase.date)),
      );
    }
    const status: WashSaleStatus = !need.isPositive()
      ? "disallowed"
      : last > coverageEnd
        ? "undetermined"
        : replaced.isZero()
          ? "allowed"
          : "partial";
    verdicts.set(sale.key, { status, replaced });
  }
  return verdicts;
}
