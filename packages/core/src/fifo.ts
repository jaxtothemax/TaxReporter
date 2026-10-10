/**
 * First in, first out, per security, across every broker and account of the
 * taxpayer (ZDoh-2 Art. 103(1): the obligation sits with the taxpayer, not
 * the account; docs/research/04-si-tax-rules.md §4.4). All lots of one ISIN
 * form one queue, whichever export they came from.
 *
 * Quantities stay exact and in each trade's own currency here; conversion to
 * EUR and rounding to form fields happen later, per leg at its own date.
 *
 * The engine takes only a validated ledger (`validateLedger`): every event
 * has its proper shape and is there once. The result depends on the events
 * alone, never on the order in which files were loaded.
 */
import { compareText } from "./compare.js";
import type { IsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { daysBetween } from "./holding.js";
import { LIMITS } from "./limits.js";
import type {
  KeyedEvent,
  SecurityRef,
  SplitEvent,
  TradeEvent,
} from "./ledger.js";
import type { ValidatedLedger } from "./validate.js";

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
  /** Symbol and name, from the earliest event that carried them. */
  readonly security: SecurityRef;
  readonly purchases: readonly TradeEvent[];
  readonly disposals: readonly Disposal[];
  /** Each split once, however many brokers reported it. */
  readonly splits: readonly SplitEvent[];
  /** Lots still held after the last event. */
  readonly open: readonly OpenLot[];
}

export interface FifoOptions {
  /**
   * Per ISIN, the last day to read: that security's later trades and
   * splits are left out, as if the files ended there. For holdings shown
   * as of a day (ADR-0017); the returns read every event.
   */
  readonly through?: ReadonlyMap<string, IsoDate>;
}

export interface FifoResult {
  readonly securities: ReadonlyMap<string, SecurityHistory>;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Split terms are whole numbers up to this. Real splits are (50 for 1, 1 for
 * 1,000), and the bound keeps a hostile ratio from making every quantity
 * after it enormous. `validateLedger` refuses a split beyond it.
 */
export const MAX_SPLIT_TERM = LIMITS.splitTerm;

/** More splits than this on one security is no real history. */
export const MAX_SPLITS = LIMITS.splitsPerSecurity;

/**
 * Brokers can date one split a few days apart: the ex-date, the day they
 * booked it. Reports of one ratio from different accounts this close
 * together are one split.
 */
export const SPLIT_REPORT_DAYS = 14;

/** How many accounts' reports of one split the merge expects at most. */
const MAX_SPLIT_REPORTERS = LIMITS.splitReporters;

/**
 * Same-day order: a split first (trades on its effective day are already in
 * new shares), then purchases, then sales, so a sale can use shares bought
 * earlier that day.
 */
const SAME_DAY_ORDER = { split: 0, buy: 1, sell: 2 } as const;

type Step = TradeEvent | SplitEvent;

function rank(step: Step): number {
  return step.kind === "split"
    ? SAME_DAY_ORDER.split
    : SAME_DAY_ORDER[step.side];
}

/**
 * Within one day: by the brokers' clocks where they tell, since FIFO
 * disposes first of what was acquired first (ZDoh-2 Art. 103(1); research
 * 04 §4.4) and UTC instants compare across brokers; then by broker, account
 * and key, never by reading order, so loading the files in another order
 * cannot change the return. An event without a time comes first.
 */
function sameDay(a: KeyedEvent, b: KeyedEvent): number {
  return (
    compareText(a.at.instant ?? "", b.at.instant ?? "") ||
    compareText(a.broker, b.broker) ||
    compareText(a.account, b.account) ||
    compareText(a.key, b.key)
  );
}

/**
 * Shares as of `to` per share as of `from`, for the splits in between. A
 * trade on a split's own day is already in new shares (`SAME_DAY_ORDER`),
 * so a split counts from the day after `from` through `to`.
 */
export function splitFactor(
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

/** Date order, and within a day the order the clocks give. */
export function chronological(a: KeyedEvent, b: KeyedEvent): number {
  return compareText(a.date, b.date) || sameDay(a, b);
}

const byTime = (a: Step, b: Step) =>
  compareText(a.date, b.date) || rank(a) - rank(b) || sameDay(a, b);

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
 * One split reported by several accounts would otherwise restate every lot
 * once per report. Reports of the same ratio from different accounts within
 * SPLIT_REPORT_DAYS are one split, dated by the earliest; a different ratio
 * blocks. When the dates differ, a trade in the later-reporting account
 * between them was in old shares there and new shares here, so it blocks
 * too: which basis it used is for the user to settle. One account's own
 * repeated report is gone by now: `validateLedger` merged it by key.
 */
function mergeSplitReports(
  isin: string,
  ordered: readonly Step[],
  diagnostics: Diagnostic[],
): Step[] {
  const kept: { split: SplitEvent; accounts: Set<string> }[] = [];
  const dropped = new Set<Step>();
  // Bounded before the merge, whose search is per report: room for every
  // allowed split reported by a few accounts, and no more.
  const reports = ordered.filter((s) => s.kind === "split");
  if (reports.length > MAX_SPLITS * MAX_SPLIT_REPORTERS) {
    diagnostics.push(diagnostic("blocking", "tooManySplits", { isin }));
    for (const extra of reports.slice(MAX_SPLITS * MAX_SPLIT_REPORTERS)) {
      dropped.add(extra);
    }
  }
  for (const step of ordered) {
    if (step.kind !== "split" || dropped.has(step)) continue;
    const near = kept.find(
      (k) =>
        !k.accounts.has(step.account) &&
        daysBetween(k.split.date, step.date) <= SPLIT_REPORT_DAYS,
    );
    if (near === undefined) {
      kept.push({ split: step, accounts: new Set([step.account]) });
      continue;
    }
    dropped.add(step);
    const first = near.split;
    if (!first.to.times(step.from).equals(step.to.times(first.from))) {
      diagnostics.push(
        diagnostic(
          "blocking",
          "splitConflict",
          { isin, date: step.date },
          step.source,
        ),
      );
      continue;
    }
    near.accounts.add(step.account);
    const between = ordered.some(
      (s) =>
        s.kind === "trade" &&
        s.account === step.account &&
        s.date >= first.date &&
        s.date < step.date,
    );
    diagnostics.push(
      between
        ? diagnostic(
            "blocking",
            "splitDateAmbiguous",
            { isin, date: first.date, until: step.date },
            step.source,
          )
        : diagnostic("info", "splitReportsMerged", { isin, date: first.date }),
    );
  }
  let splits = 0;
  return ordered.filter((step) => {
    if (dropped.has(step)) return false;
    if (step.kind !== "split") return true;
    splits += 1;
    if (splits === MAX_SPLITS + 1) {
      diagnostics.push(diagnostic("blocking", "tooManySplits", { isin }));
    }
    return splits <= MAX_SPLITS;
  });
}

/**
 * Matches every sale of the ledger to the purchases before it, reading
 * each security through `options.through` where it names one. Dividends
 * and the tax on them are Doh-Div's, and pass through untouched.
 */
export function matchFifo(
  ledger: ValidatedLedger,
  options: FifoOptions = {},
): FifoResult {
  const diagnostics: Diagnostic[] = [];
  const steps = new Map<string, Step[]>();
  for (const event of ledger.events) {
    if (event.kind !== "trade" && event.kind !== "split") continue;
    const isin = event.kind === "trade" ? event.security.isin : event.isin;
    const last = options.through?.get(isin);
    if (last !== undefined && event.date > last) continue;
    const list = steps.get(isin);
    if (list === undefined) steps.set(isin, [event]);
    else list.push(event);
  }

  const result = new Map<string, SecurityHistory>();
  for (const isin of [...steps.keys()].sort(compareText)) {
    const ordered = mergeSplitReports(
      isin,
      (steps.get(isin) ?? []).sort(byTime),
      diagnostics,
    );

    const unordered = unorderedDays(ordered);
    let security: SecurityRef | undefined;
    // A queue read from `head`, so consuming a lot never copies the rest.
    let lots: OpenLot[] = [];
    let head = 0;
    const purchases: TradeEvent[] = [];
    const disposals: Disposal[] = [];
    const splits: SplitEvent[] = [];

    for (const step of ordered) {
      if (step.kind === "split") {
        const ratio = step.to.dividedBy(step.from);
        if (step.positionChange !== undefined) {
          checkSplit(step, ratio, lots.slice(head), diagnostics);
        }
        lots = lots.slice(head).map((lot) => ({
          purchase: lot.purchase,
          quantity: lot.quantity.times(ratio),
          factor: lot.factor.times(ratio),
        }));
        head = 0;
        splits.push(step);
        continue;
      }
      security = mergeSecurity(security, step.security);
      if (step.side === "buy") {
        purchases.push(step);
        lots.push({
          purchase: step,
          quantity: step.quantity,
          factor: Decimal.ONE,
        });
        if (step.price.amount.isZero()) {
          // A share received for nothing may be income, not a purchase.
          diagnostics.push(
            diagnostic(
              "warning",
              "zeroCostPurchase",
              { isin, date: step.date },
              step.source,
            ),
          );
        }
        continue;
      }
      let need = step.quantity;
      const matches: LotMatch[] = [];
      while (need.isPositive()) {
        const lot = lots[head];
        if (lot === undefined) break;
        const take = lot.quantity.lessThan(need) ? lot.quantity : need;
        matches.push({
          purchase: lot.purchase,
          quantity: take,
          factor: lot.factor,
        });
        need = need.minus(take);
        const left = lot.quantity.minus(take);
        if (left.isPositive()) lots[head] = { ...lot, quantity: left };
        else head += 1;
      }
      // The sale ends inside a day whose lots the ledger cannot order.
      const last = matches.at(-1)?.purchase;
      if (
        last !== undefined &&
        lots[head]?.purchase.date === last.date &&
        unordered.has(last.date)
      ) {
        diagnostics.push(
          diagnostic(
            "warning",
            "sameDayLotOrder",
            { isin, date: step.date, purchased: last.date },
            step.source,
          ),
        );
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
      security: security ?? { isin },
      purchases,
      disposals,
      splits,
      open: lots.slice(head),
    });
  }
  return { securities: result, diagnostics };
}

/**
 * A split whose broker reported the shares it gained rather than the ratio:
 * the ratio, read from the broker's wording, has to turn the shares that
 * broker's accounts held into the change it reported. Otherwise the ratio
 * would restate every lot of the security, other brokers' too, on a guess.
 * The broker's shares are the lots it sold or bought, so shares moved in
 * from another broker make the check block rather than pass.
 */
function checkSplit(
  split: SplitEvent,
  ratio: Decimal,
  lots: readonly OpenLot[],
  diagnostics: Diagnostic[],
): void {
  const held = Decimal.sum(
    lots
      .filter((lot) => lot.purchase.broker === split.broker)
      .map((lot) => lot.quantity),
  );
  const expected = held.times(ratio).minus(held);
  const reported = split.positionChange ?? Decimal.ZERO;
  if (held.isZero() || !expected.equals(reported)) {
    diagnostics.push(
      diagnostic(
        "blocking",
        "splitPositionMismatch",
        {
          isin: split.isin,
          date: split.date,
          // A reverse split's change can repeat forever; shown, never used.
          expected: expected.toPlain(10, "halfUp"),
          reported: reported.toPlain(10, "halfUp"),
        },
        split.source,
      ),
    );
  }
}

/**
 * Purchase dates whose lots the brokers' clocks leave out of order: two at
 * different prices where either has no time, or both the same one. Such a
 * day's lots are queued by broker, account and key, and a sale that ends
 * partway through the day might have been matched to other lots, at another
 * cost, in another order.
 */
function unorderedDays(steps: readonly Step[]): ReadonlySet<IsoDate> {
  interface Day {
    readonly prices: Set<string>;
    /** The prices bought at each instant of the day. */
    readonly instants: Map<string, Set<string>>;
    untimed: boolean;
  }
  const days = new Map<IsoDate, Day>();
  for (const step of steps) {
    if (step.kind !== "trade" || step.side !== "buy") continue;
    const day: Day = days.get(step.date) ?? {
      prices: new Set(),
      instants: new Map(),
      untimed: false,
    };
    const price = JSON.stringify([
      step.price.currency,
      step.price.amount.toFixed(12, "halfUp"),
    ]);
    day.prices.add(price);
    const instant = step.at.instant;
    if (instant === null) {
      day.untimed = true;
    } else {
      const prices = day.instants.get(instant) ?? new Set<string>();
      prices.add(price);
      day.instants.set(instant, prices);
    }
    days.set(step.date, day);
  }
  const unordered = new Set<IsoDate>();
  for (const [date, day] of days) {
    if (day.prices.size < 2) continue;
    if (day.untimed || [...day.instants.values()].some((p) => p.size > 1)) {
      unordered.add(date);
    }
  }
  return unordered;
}
