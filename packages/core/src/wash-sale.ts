/**
 * The 30-day rule (pravilo navidezne odsvojitve, ZDoh-2 Art. 97(5)): a loss
 * does not reduce the tax base when the taxpayer acquires the same kind of
 * capital within 30 days before or after the sale. The FURS reading this
 * follows (docs/research/04-si-tax-rules.md §5.3):
 *
 * - the window is 61 days, the sale day plus 30 on each side;
 * - replacement is measured by quantity, and only the replaced part of the
 *   loss is disallowed. The quantity is the shares sold at a loss: the rule
 *   applies only to losses, so a sale's gain shares need no replacement and
 *   use none up;
 * - loss sales are taken in date order, and each acquisition can replace
 *   only once;
 * - the lots a sale consumes, including the unsold rest of a lot it sells
 *   from, are never its own replacement (so selling the whole position,
 *   window purchases included, keeps the whole loss).
 *
 * Which shares a sale lost on depends on EUR values, so the caller decides
 * that and passes the loss sales in, each with its loss quantity. Family
 * members and companies the taxpayer holds 25% of are the other trigger of
 * the rule; broker data cannot show them, so the app has to ask.
 */
import { isIsoDate, type IsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { chronological, type Disposal, type SecurityHistory } from "./fifo.js";
import { addDays } from "./holding.js";
import type { SplitEvent, TradeEvent } from "./ledger.js";

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

/** A sale at a loss, and how many of its shares lost. */
export interface LossSale {
  readonly disposal: Disposal;
  /**
   * The shares sold at a loss, in shares as of the sale date: the lots the
   * sale consumed that lose money at eDavki's valuation, exempt lots aside.
   * Only these need replacing.
   */
  readonly quantity: Decimal;
}

/**
 * Verdicts for the loss sales of one security, by the sale event itself.
 * Purchases and sales are told apart as the objects FIFO matched, never by
 * key: a key is unique only within its account, and two accounts' purchases
 * under one key are two purchases. Purchases and sales are taken in the
 * order they happened, whatever order they come in, so the result never
 * depends on how files were loaded.
 * Losses of earlier years belong in `losses` too: a purchase that replaced
 * a December loss cannot replace a January one as well.
 */
export function washSaleVerdicts(
  history: SecurityHistory,
  losses: readonly LossSale[],
  coverageEnd: IsoDate,
): ReadonlyMap<TradeEvent, WashSaleVerdict> {
  // A malformed date would compare as text and decide verdicts it cannot.
  if (!isIsoDate(coverageEnd)) {
    throw new RangeError("coverageEnd must be an ISO date (YYYY-MM-DD)");
  }
  const purchases = [...history.purchases].sort(chronological);
  // Replacement capacity left per purchase, in that purchase's own shares.
  const capacity = new Map<TradeEvent, Decimal>(
    purchases.map((p) => [p, p.quantity]),
  );
  const verdicts = new Map<TradeEvent, WashSaleVerdict>();
  const ordered = losses
    .filter((loss) => loss.quantity.isPositive())
    .sort((a, b) => chronological(a.disposal.sale, b.disposal.sale));

  for (const { disposal, quantity } of ordered) {
    const sale = disposal.sale;
    const own = new Set(disposal.matches.map((m) => m.purchase));
    const first = addDays(sale.date, -WASH_SALE_DAYS);
    const last = addDays(sale.date, WASH_SALE_DAYS);
    let need = quantity;
    let replaced = Decimal.ZERO;
    for (const purchase of purchases) {
      if (!need.isPositive()) break;
      if (purchase.date < first || purchase.date > last) continue;
      if (own.has(purchase)) continue;
      const left = capacity.get(purchase) ?? Decimal.ZERO;
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
        purchase,
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
    verdicts.set(sale, { status, replaced });
  }
  return verdicts;
}
