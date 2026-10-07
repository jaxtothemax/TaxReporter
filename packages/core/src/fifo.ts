/**
 * First in, first out, per security, across every broker and account of the
 * taxpayer (ZDoh-2 Art. 103(1): the obligation sits with the taxpayer, not
 * the account; docs/research/04-si-tax-rules.md §4.4). All lots of one ISIN
 * form one queue, whichever export they came from.
 *
 * Quantities stay exact and in each trade's own currency here; conversion to
 * EUR and rounding to form fields happen later, per leg at its own date.
 */
import { Decimal } from "./decimal.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import type {
  LedgerEvent,
  SecurityRef,
  SplitEvent,
  TradeEvent,
} from "./ledger.js";

export interface OpenLot {
  readonly purchase: TradeEvent;
  /** What is left, in shares as they are after every split so far. */
  readonly quantity: Decimal;
  /** How many of today's shares one purchased share has become. */
  readonly factor: Decimal;
}

export interface LotMatch {
  readonly purchase: TradeEvent;
  /** The matched quantity, in shares as of the sale date. */
  readonly quantity: Decimal;
  /** Shares as of the sale date per purchased share (splits in between). */
  readonly factor: Decimal;
}

export interface Disposal {
  readonly sale: TradeEvent;
  /** Oldest lot first. */
  readonly matches: readonly LotMatch[];
  /** What no purchase covered: zero unless earlier exports are missing. */
  readonly unmatched: Decimal;
}

export interface SecurityHistory {
  readonly isin: string;
  /** Symbol and name from whichever event carried them first. */
  readonly security: SecurityRef;
  readonly purchases: readonly TradeEvent[];
  readonly disposals: readonly Disposal[];
  readonly splits: readonly SplitEvent[];
  /** Lots still held after the last event. */
  readonly open: readonly OpenLot[];
}

export interface FifoResult {
  readonly securities: ReadonlyMap<string, SecurityHistory>;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Same-day order: a split first (trades on its effective day are already in
 * new shares), then purchases, then sales, so a sale can use shares bought
 * earlier that day; ties keep the order the events were read in.
 */
const SAME_DAY_ORDER = { split: 0, buy: 1, sell: 2 } as const;

type Step = TradeEvent | SplitEvent;

function rank(step: Step): number {
  return step.kind === "split"
    ? SAME_DAY_ORDER.split
    : SAME_DAY_ORDER[step.side];
}

function mergeSecurity(
  into: SecurityRef | undefined,
  from: SecurityRef,
): SecurityRef {
  if (into === undefined) return from;
  const symbol = into.symbol ?? from.symbol;
  const name = into.name ?? from.name;
  return {
    isin: into.isin,
    ...(symbol === undefined ? {} : { symbol }),
    ...(name === undefined ? {} : { name }),
    ...(into.isFund === true || from.isFund === true ? { isFund: true } : {}),
  };
}

/**
 * Removes events read twice from overlapping exports, by their stable key.
 * The first occurrence wins; the count is reported, never silently dropped.
 */
export function deduplicate(events: readonly LedgerEvent[]): {
  readonly events: readonly LedgerEvent[];
  readonly diagnostics: readonly Diagnostic[];
} {
  const seen = new Set<string>();
  const kept: LedgerEvent[] = [];
  let duplicates = 0;
  for (const event of events) {
    if (event.kind !== "ignored") {
      if (seen.has(event.key)) {
        duplicates += 1;
        continue;
      }
      seen.add(event.key);
    }
    kept.push(event);
  }
  return {
    events: kept,
    diagnostics:
      duplicates === 0
        ? []
        : [
            diagnostic("info", "duplicatesRemoved", {
              count: String(duplicates),
            }),
          ],
  };
}

export function matchFifo(input: readonly LedgerEvent[]): FifoResult {
  const { events, diagnostics: dedup } = deduplicate(input);
  const diagnostics: Diagnostic[] = [...dedup];

  const steps = new Map<string, Step[]>();
  const securities = new Map<string, SecurityRef>();
  for (const event of events) {
    if (event.kind === "trade") {
      const isin = event.security.isin;
      securities.set(isin, mergeSecurity(securities.get(isin), event.security));
      steps.set(isin, [...(steps.get(isin) ?? []), event]);
    } else if (event.kind === "split") {
      steps.set(event.isin, [...(steps.get(event.isin) ?? []), event]);
    }
  }

  const result = new Map<string, SecurityHistory>();
  for (const [isin, unsorted] of steps) {
    // A stable sort, so events of one day keep their reading order.
    const ordered = unsorted
      .map((step, index) => ({ step, index }))
      .sort(
        (a, b) =>
          a.step.date.localeCompare(b.step.date) ||
          rank(a.step) - rank(b.step) ||
          a.index - b.index,
      )
      .map(({ step }) => step);

    let lots: OpenLot[] = [];
    const purchases: TradeEvent[] = [];
    const disposals: Disposal[] = [];
    const splits: SplitEvent[] = [];

    for (const step of ordered) {
      if (step.kind === "split") {
        if (!step.from.isPositive() || !step.to.isPositive()) {
          diagnostics.push(
            diagnostic(
              "blocking",
              "invalidSplit",
              { isin, date: step.date },
              step.source,
            ),
          );
          continue;
        }
        const ratio = step.to.dividedBy(step.from);
        lots = lots.map((lot) => ({
          purchase: lot.purchase,
          quantity: lot.quantity.times(ratio),
          factor: lot.factor.times(ratio),
        }));
        splits.push(step);
        continue;
      }
      if (!step.quantity.isPositive()) {
        diagnostics.push(
          diagnostic(
            "blocking",
            "invalidTrade",
            { isin, date: step.date },
            step.source,
          ),
        );
        continue;
      }
      if (step.side === "buy") {
        purchases.push(step);
        lots.push({
          purchase: step,
          quantity: step.quantity,
          factor: Decimal.ONE,
        });
        continue;
      }
      let need = step.quantity;
      const matches: LotMatch[] = [];
      while (need.isPositive() && lots.length > 0) {
        const [lot, ...rest] = lots as [OpenLot, ...OpenLot[]];
        const take = lot.quantity.lessThan(need) ? lot.quantity : need;
        matches.push({
          purchase: lot.purchase,
          quantity: take,
          factor: lot.factor,
        });
        need = need.minus(take);
        const left = lot.quantity.minus(take);
        lots = left.isPositive() ? [{ ...lot, quantity: left }, ...rest] : rest;
      }
      if (need.isPositive()) {
        // Never guess a purchase: the user has to add the earlier export.
        diagnostics.push(
          diagnostic(
            "blocking",
            "insufficientHistory",
            // A reverse split can leave a fraction with no finite decimal
            // expansion, so the shown quantity is rounded for display only.
            { isin, date: step.date, missing: need.toPlain(10, "halfUp") },
            step.source,
          ),
        );
      }
      disposals.push({ sale: step, matches, unmatched: need });
    }

    result.set(isin, {
      isin,
      security: securities.get(isin) ?? { isin },
      purchases,
      disposals,
      splits,
      open: lots,
    });
  }
  return { securities: result, diagnostics };
}
