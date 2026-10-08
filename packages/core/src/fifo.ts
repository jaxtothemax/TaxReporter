/**
 * First in, first out, per security, across every broker and account of the
 * taxpayer (ZDoh-2 Art. 103(1): the obligation sits with the taxpayer, not
 * the account; docs/research/04-si-tax-rules.md §4.4). All lots of one ISIN
 * form one queue, whichever export they came from.
 *
 * Quantities stay exact and in each trade's own currency here; conversion to
 * EUR and rounding to form fields happen later, per leg at its own date.
 *
 * The engine trusts no adapter. Every event is checked as it comes in, and
 * one that fails blocks rather than being guessed at; and the result depends
 * on the events alone, never on the order in which files were loaded.
 */
import { isIsoDate, type IsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { daysBetween } from "./holding.js";
import { isIsin } from "./isin.js";
import { LIMITS } from "./limits.js";
import type {
  IgnoredRow,
  LedgerEvent,
  Money,
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
  /** Symbol and name, from the earliest event that carried them. */
  readonly security: SecurityRef;
  readonly purchases: readonly TradeEvent[];
  readonly disposals: readonly Disposal[];
  /** Each split once, however many brokers reported it. */
  readonly splits: readonly SplitEvent[];
  /** Lots still held after the last event. */
  readonly open: readonly OpenLot[];
}

export interface FifoResult {
  readonly securities: ReadonlyMap<string, SecurityHistory>;
  readonly diagnostics: readonly Diagnostic[];
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Split terms are whole numbers up to this. Real splits are (50 for 1, 1 for
 * 1,000), and the bound keeps a hostile ratio from making every quantity
 * after it enormous.
 */
export const MAX_SPLIT_TERM = LIMITS.splitTerm;

/** More splits than this on one security is no real history. */
export const MAX_SPLITS = LIMITS.splitsPerSecurity;

/**
 * Brokers can date one split a few days apart: the ex-date, the day they
 * booked it. Reports of one ratio from different brokers this close
 * together are one split.
 */
export const SPLIT_REPORT_DAYS = 14;

/** How many brokers' reports of one split the merge expects at most. */
const MAX_SPLIT_REPORTERS = LIMITS.splitReporters;

const MAX_TERM = Decimal.fromInteger(MAX_SPLIT_TERM);
/**
 * ISO codes in capitals, or the pence and cents codes the rate table
 * scales. Never case-folded: GBp is not GBP, a hundredfold difference.
 */
const CURRENCY = /^(?:[A-Z]{3}|GBp|ZAc)$/;

/**
 * Same-day order: a split first (trades on its effective day are already in
 * new shares), then purchases, then sales, so a sale can use shares bought
 * earlier that day. Ties go by broker and key, never by reading order: the
 * time of day is not in the ledger, and loading the files in another order
 * must not change the return.
 */
const SAME_DAY_ORDER = { split: 0, buy: 1, sell: 2 } as const;

type Step = TradeEvent | SplitEvent;
type KeyedEvent = Exclude<LedgerEvent, IgnoredRow>;

function rank(step: Step): number {
  return step.kind === "split"
    ? SAME_DAY_ORDER.split
    : SAME_DAY_ORDER[step.side];
}

const byTime = (a: Step, b: Step) =>
  compareText(a.date, b.date) ||
  rank(a) - rank(b) ||
  compareText(a.broker, b.broker) ||
  compareText(a.key, b.key);

/** A property of a value of unknown shape. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/**
 * An event's ISIN and date as diagnostic parameters, each only when it has
 * its proper shape, so that no text from a file is ever echoed.
 */
function identify(isin: unknown, date: unknown): Record<string, string> {
  return {
    ...(typeof isin === "string" && isIsin(isin) ? { isin } : {}),
    ...(typeof date === "string" && isIsoDate(date) ? { date } : {}),
  };
}

const isWholeTerm = (value: unknown): boolean =>
  value instanceof Decimal &&
  value.isPositive() &&
  value.isExactAt(0) &&
  !value.greaterThan(MAX_TERM);

/** Why an event cannot be used, as a blocking diagnostic, or null. */
function refusal(event: LedgerEvent): Diagnostic | null {
  const kind: unknown = field(event, "kind");
  const source = field(event, "source");
  const sourceOk =
    isText(field(source, "file")) && Number.isSafeInteger(field(source, "row"));
  const at = sourceOk ? event.source : undefined;
  if (kind === "ignored") return null;
  if (
    kind !== "trade" &&
    kind !== "split" &&
    kind !== "dividend" &&
    kind !== "withholding"
  ) {
    return diagnostic("blocking", "unknownEvent", {}, at);
  }
  const base =
    sourceOk && isText(field(event, "key")) && isText(field(event, "broker"));
  if (kind === "trade") {
    const security = field(event, "security");
    const price = field(event, "price");
    const side = field(event, "side");
    const quantity = field(event, "quantity");
    const amount = field(price, "amount");
    const currency = field(price, "currency");
    const ok =
      base &&
      typeof side === "string" &&
      (side === "buy" || side === "sell") &&
      isIsoDate(field(event, "date")) &&
      isIsin(field(security, "isin")) &&
      quantity instanceof Decimal &&
      quantity.isPositive() &&
      amount instanceof Decimal &&
      !amount.isNegative() &&
      typeof currency === "string" &&
      CURRENCY.test(currency);
    return ok
      ? null
      : diagnostic(
          "blocking",
          "invalidTrade",
          identify(field(security, "isin"), field(event, "date")),
          at,
        );
  }
  if (kind === "split") {
    const ok =
      base &&
      isIsoDate(field(event, "date")) &&
      isIsin(field(event, "isin")) &&
      isWholeTerm(field(event, "from")) &&
      isWholeTerm(field(event, "to"));
    return ok
      ? null
      : diagnostic(
          "blocking",
          "invalidSplit",
          identify(field(event, "isin"), field(event, "date")),
          at,
        );
  }
  // Dividends and withholdings are the Doh-Div builder's to check.
  return null;
}

const sameMoney = (a: Money, b: Money) =>
  a.currency === b.currency && a.amount.equals(b.amount);

/** Whether two reports of one event, read from different files, agree. */
function sameContent(a: KeyedEvent, b: KeyedEvent): boolean {
  switch (a.kind) {
    case "trade":
      return (
        b.kind === "trade" &&
        a.side === b.side &&
        a.date === b.date &&
        a.security.isin === b.security.isin &&
        a.quantity.equals(b.quantity) &&
        sameMoney(a.price, b.price)
      );
    case "split":
      return (
        b.kind === "split" &&
        a.date === b.date &&
        a.isin === b.isin &&
        a.to.times(b.from).equals(b.to.times(a.from))
      );
    case "dividend":
      return (
        b.kind === "dividend" &&
        a.date === b.date &&
        a.security.isin === b.security.isin &&
        sameMoney(a.gross, b.gross)
      );
    case "withholding":
      return (
        b.kind === "withholding" &&
        a.date === b.date &&
        a.isin === b.isin &&
        a.dividendKey === b.dividendKey &&
        sameMoney(a.amount, b.amount)
      );
  }
}

const isinOf = (event: KeyedEvent) =>
  event.kind === "trade" || event.kind === "dividend"
    ? event.security.isin
    : event.isin;

/** An event's identity: a key is unique only within its broker. */
export function eventId(event: {
  readonly broker: string;
  readonly key: string;
}): string {
  return JSON.stringify([event.broker, event.key]);
}

/** Order by where an event was read: file label, then row. */
const bySource = (a: KeyedEvent, b: KeyedEvent) =>
  compareText(a.source.file, b.source.file) || a.source.row - b.source.row;

/**
 * Removes events read twice from overlapping exports. An event's identity
 * is its broker and its key, so two brokers' keys never collide. Of the
 * reports of one event, the one read first by file and row stands, so the
 * names and sources that come with it never depend on the order in which
 * files were loaded. A repeat from another file that says the same is the
 * overlap: dropped, and counted. A repeat within one file, or one that says
 * something else, blocks instead: one export never lists a row twice, and
 * which of two disagreeing reports is right is the user's call.
 */
export function deduplicate(events: readonly LedgerEvent[]): {
  readonly events: readonly LedgerEvent[];
  readonly diagnostics: readonly Diagnostic[];
} {
  const groups = new Map<string, KeyedEvent[]>();
  const order: (string | IgnoredRow)[] = [];
  for (const event of events) {
    if (event.kind === "ignored") {
      order.push(event);
      continue;
    }
    const id = eventId(event);
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, [event]);
      order.push(id);
    } else {
      group.push(event);
    }
  }
  const diagnostics: Diagnostic[] = [];
  let duplicates = 0;
  const survivors = new Map<string, KeyedEvent>();
  for (const [id, group] of groups) {
    const reports = [...group].sort(bySource);
    const [survivor] = reports as [KeyedEvent, ...KeyedEvent[]];
    survivors.set(id, survivor);
    const files = new Set([survivor.source.file]);
    for (const report of reports.slice(1)) {
      const where = identify(isinOf(report), report.date);
      if (files.has(report.source.file)) {
        diagnostics.push(
          diagnostic("blocking", "duplicateKeyInFile", where, report.source),
        );
      } else if (!sameContent(survivor, report)) {
        diagnostics.push(
          diagnostic("blocking", "duplicateKeyConflict", where, report.source),
        );
      } else {
        duplicates += 1;
      }
      files.add(report.source.file);
    }
  }
  diagnostics.sort((a, b) =>
    a.source === undefined || b.source === undefined
      ? 0
      : compareText(a.source.file, b.source.file) ||
        a.source.row - b.source.row,
  );
  if (duplicates > 0) {
    diagnostics.unshift(
      diagnostic("info", "duplicatesRemoved", { count: duplicates }),
    );
  }
  return {
    events: order.map((entry) =>
      typeof entry === "string" ? (survivors.get(entry) as KeyedEvent) : entry,
    ),
    diagnostics,
  };
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
 * One split reported by several brokers would otherwise restate every lot
 * once per report. Reports of the same ratio from different brokers within
 * SPLIT_REPORT_DAYS are one split, dated by the earliest; a different
 * ratio blocks. When the dates differ, a trade at the later-reporting
 * broker between them was in old shares there and new shares here, so it
 * blocks too: which basis it used is for the user to settle.
 */
function mergeSplitReports(
  isin: string,
  ordered: readonly Step[],
  diagnostics: Diagnostic[],
): Step[] {
  const kept: { split: SplitEvent; brokers: Set<string> }[] = [];
  const dropped = new Set<Step>();
  // Bounded before the merge, whose search is per report: room for every
  // allowed split reported by a few brokers, and no more.
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
        !k.brokers.has(step.broker) &&
        daysBetween(k.split.date, step.date) <= SPLIT_REPORT_DAYS,
    );
    if (near === undefined) {
      kept.push({ split: step, brokers: new Set([step.broker]) });
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
    near.brokers.add(step.broker);
    const between = ordered.some(
      (s) =>
        s.kind === "trade" &&
        s.broker === step.broker &&
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

export function matchFifo(input: readonly LedgerEvent[]): FifoResult {
  const diagnostics: Diagnostic[] = [];
  const checked: LedgerEvent[] = [];
  for (const event of input) {
    const problem = refusal(event);
    if (problem === null) checked.push(event);
    else diagnostics.push(problem);
  }
  diagnostics.sort((a, b) =>
    a.source === undefined || b.source === undefined
      ? 0
      : compareText(a.source.file, b.source.file) ||
        a.source.row - b.source.row,
  );
  const { events, diagnostics: dedup } = deduplicate(checked);
  diagnostics.push(...dedup);

  const steps = new Map<string, Step[]>();
  for (const event of events) {
    if (event.kind !== "trade" && event.kind !== "split") continue;
    const isin = event.kind === "trade" ? event.security.isin : event.isin;
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

    const mixed = mixedDays(ordered);
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
        mixed.has(last.date)
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
 * Purchase dates whose lots came from more than one broker at more than one
 * price. The ledger has no time of day, so such a day's lots are queued by
 * broker and key, and a sale that ends partway through the day might have
 * been matched to other lots, at another cost, in another order.
 */
function mixedDays(steps: readonly Step[]): ReadonlySet<IsoDate> {
  const days = new Map<
    IsoDate,
    { brokers: Set<string>; prices: Set<string> }
  >();
  for (const step of steps) {
    if (step.kind !== "trade" || step.side !== "buy") continue;
    const day = days.get(step.date) ?? {
      brokers: new Set(),
      prices: new Set(),
    };
    day.brokers.add(step.broker);
    day.prices.add(
      JSON.stringify([
        step.price.currency,
        step.price.amount.toFixed(12, "halfUp"),
      ]),
    );
    days.set(step.date, day);
  }
  const mixed = new Set<IsoDate>();
  for (const [date, day] of days) {
    if (day.brokers.size > 1 && day.prices.size > 1) mixed.add(date);
  }
  return mixed;
}
