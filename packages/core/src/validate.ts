/**
 * The one door into the engine (ADR 0011). Every event is checked here and
 * nowhere else: one that fails is refused with a blocking diagnostic, never
 * guessed at, and never echoed. The reports of one event across overlapping
 * files become one, and two files of one account that disagree about what
 * happened while both were recording stop the import. FIFO and both form
 * builders take only the `ValidatedLedger` that comes out, and since it is
 * in a fixed order, nothing after it depends on the order files were loaded.
 */
import { compareText } from "./compare.js";
import { isIsoDate, ljubljanaDate, taxDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import {
  diagnostic,
  fileRef,
  type Diagnostic,
  type FileRef,
} from "./diagnostics.js";
import { isIsin } from "./isin.js";
import type {
  FileId,
  IgnoredReason,
  KeyedEvent,
  LedgerEvent,
  Money,
  SourceRef,
} from "./ledger.js";
import { LIMITS } from "./limits.js";

declare const validated: unique symbol;

/**
 * What `validateLedger` passed, and what it found. Only it makes one, so a
 * function that takes one knows its events were checked.
 */
export interface ValidatedLedger {
  /** One report of each event, in file and row order. */
  readonly events: readonly LedgerEvent[];
  /** A blocking finding here withholds every form built from the ledger. */
  readonly diagnostics: readonly Diagnostic[];
  readonly [validated]: true;
}

/** 128 bits in hex, as the key builder writes them. */
const KEY = /^[0-9a-f]{32}$/;
/** 64 bits of a file's SHA-256 in hex, as intake writes them. */
const FILE_ID = /^[0-9a-f]{16}$/;
const BROKER = /^[a-z0-9]{1,32}$/;
/**
 * An account's label is a group number the user chose, or the 128-bit hash
 * `accountScope` makes of an account's own ID: never the ID itself.
 */
const GROUP = /^[1-9][0-9]{0,2}$/;
const HASHED_ACCOUNT = /^[0-9a-f]{32}$/;
const PART = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * ISO codes in capitals, or the pence and cents codes the rate table
 * scales. Never case-folded: GBp is not GBP, a hundredfold difference.
 */
const CURRENCY = /^(?:[A-Z]{3}|GBp|ZAc)$/;

const IGNORED_REASONS: ReadonlySet<unknown> = new Set<IgnoredReason>([
  "deposit",
  "withdrawal",
  "interest",
  "currencyConversion",
  "cardSpending",
  "fee",
  "cashTransfer",
  "header",
  "pairedRow",
]);

const KINDS = ["trade", "split", "dividend", "withholding"] as const;

/** A property of a value of unknown shape. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);

const isClock = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const optional = (value: unknown, type: "string" | "boolean") =>
  value === undefined || typeof value === type;

/**
 * An event's ISIN and date as diagnostic parameters, each only when it has
 * its proper shape, so that no text from a file is ever echoed.
 */
function identify(
  isin: unknown,
  date: unknown,
): { isin?: string; date?: string } {
  return {
    ...(typeof isin === "string" && isIsin(isin) ? { isin } : {}),
    ...(typeof date === "string" && isIsoDate(date) ? { date } : {}),
  };
}

function isMoney(value: unknown, signed: boolean): boolean {
  const amount = field(value, "amount");
  return (
    Decimal.isDecimal(amount) &&
    (signed || !amount.isNegative()) &&
    matches(field(value, "currency"), CURRENCY)
  );
}

function isSecurity(value: unknown): boolean {
  return (
    isIsin(field(value, "isin")) &&
    optional(field(value, "symbol"), "string") &&
    optional(field(value, "name"), "string") &&
    optional(field(value, "isFund"), "boolean")
  );
}

const isWholeTerm = (value: unknown): boolean =>
  Decimal.isDecimal(value) &&
  value.isPositive() &&
  value.isExactAt(0) &&
  !value.greaterThan(Decimal.fromInteger(LIMITS.splitTerm));

/** Where the event came from, when that itself has its proper shape. */
function sourceOf(event: unknown): SourceRef | undefined {
  const source = field(event, "source");
  const row = field(source, "row");
  const part = field(source, "part");
  const ok =
    matches(field(source, "fileId"), FILE_ID) &&
    typeof row === "number" &&
    Number.isSafeInteger(row) &&
    row >= 1 &&
    (part === undefined || matches(part, PART));
  return ok ? (source as SourceRef) : undefined;
}

/** `broker:label`, under the event's own broker. */
function accountOk(event: unknown): boolean {
  const broker = field(event, "broker");
  const account = field(event, "account");
  if (!matches(broker, BROKER) || typeof account !== "string") return false;
  const [prefix, label, ...rest] = account.split(":");
  return (
    prefix === broker &&
    rest.length === 0 &&
    (matches(label, HASHED_ACCOUNT) ||
      (matches(label, GROUP) && Number(label) <= LIMITS.filesPerSession))
  );
}

/**
 * Whether the event's date is what the date policy gives for its clock: an
 * adapter dates its events by the one policy, never by a rule of its own.
 */
function datedByPolicy(event: unknown): boolean {
  const at = field(event, "at");
  const instant = field(at, "instant");
  const brokerDate = field(at, "brokerDate");
  if (!isClock(instant) || !isClock(brokerDate)) return false;
  return taxDate({ instant, brokerDate })?.date === field(event, "date");
}

/** Why an event cannot be used, as a blocking diagnostic, or null. */
function refusal(event: unknown): Diagnostic | null {
  const kind = field(event, "kind");
  const source = sourceOf(event);
  if (kind === "ignored") {
    const ok =
      source !== undefined &&
      accountOk(event) &&
      IGNORED_REASONS.has(field(event, "reason"));
    return ok ? null : diagnostic("blocking", "unknownEvent", {}, source);
  }
  if (!KINDS.some((k) => k === kind)) {
    return diagnostic("blocking", "unknownEvent", {}, source);
  }
  const base =
    source !== undefined &&
    accountOk(event) &&
    matches(field(event, "key"), KEY) &&
    datedByPolicy(event);
  const date = field(event, "date");
  if (kind === "trade") {
    const security = field(event, "security");
    const side = field(event, "side");
    const quantity = field(event, "quantity");
    const commission = field(event, "commission");
    const ok =
      base &&
      (side === "buy" || side === "sell") &&
      isSecurity(security) &&
      Decimal.isDecimal(quantity) &&
      quantity.isPositive() &&
      isMoney(field(event, "price"), false) &&
      (commission === undefined || isMoney(commission, true));
    return ok
      ? null
      : diagnostic(
          "blocking",
          "invalidTrade",
          identify(field(security, "isin"), date),
          source,
        );
  }
  if (kind === "split") {
    const isin = field(event, "isin");
    const ok =
      base &&
      isIsin(isin) &&
      isWholeTerm(field(event, "from")) &&
      isWholeTerm(field(event, "to"));
    return ok
      ? null
      : diagnostic("blocking", "invalidSplit", identify(isin, date), source);
  }
  if (kind === "dividend") {
    const security = field(event, "security");
    const ok =
      base && isSecurity(security) && isMoney(field(event, "gross"), true);
    return ok
      ? null
      : diagnostic(
          "blocking",
          "invalidDividend",
          identify(field(security, "isin"), date),
          source,
        );
  }
  const isin = field(event, "isin");
  const ok =
    base &&
    isIsin(isin) &&
    matches(field(event, "dividendKey"), KEY) &&
    isMoney(field(event, "amount"), true);
  return ok
    ? null
    : diagnostic(
        "blocking",
        "invalidWithholding",
        identify(isin, date),
        source,
      );
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

/** An event's identity: its key is unique only within its account. */
export function eventId(event: {
  readonly account: string;
  readonly key: string;
}): string {
  return JSON.stringify([event.account, event.key]);
}

/** Order by where an event was read: file, part, row. */
const bySource = (a: LedgerEvent, b: LedgerEvent) =>
  compareText(a.source.fileId, b.source.fileId) ||
  compareText(a.source.part ?? "", b.source.part ?? "") ||
  a.source.row - b.source.row;

/**
 * A finding's place in the list: by file, part and row, then by code,
 * severity and parameters, so the list never depends on the order files
 * were loaded.
 */
const placeOf = (d: Diagnostic) =>
  [
    d.source?.fileId ?? "",
    d.source?.part ?? "",
    String(d.source?.row ?? 0).padStart(16, "0"),
    d.code,
    d.severity,
    JSON.stringify(d.params),
  ].join("\u0000");

/**
 * The findings in place order, each once: two files that say the same
 * about no row in particular (one fund named in two years' exports) say
 * one thing.
 */
function inPlaceOrder(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const placed = diagnostics
    .map((d) => ({ d, place: placeOf(d) }))
    .sort((a, b) => compareText(a.place, b.place));
  return placed
    .filter(
      ({ d, place }, i) =>
        d.source !== undefined || place !== placed[i - 1]?.place,
    )
    .map(({ d }) => d);
}

/** The broker's clock as one comparable string, "YYYY-MM-DDTHH:MM:SSZ". */
const clockOf = (event: KeyedEvent) =>
  event.at.instant ?? `${event.at.brokerDate ?? event.date}T00:00:00Z`;

/** The calendar day of a clock string, for the user. */
const dayOf = (clock: string) => ljubljanaDate(clock) ?? clock.slice(0, 10);

interface Entry {
  readonly clock: string;
  readonly key: string;
}

/** What one file of an account recorded, and over which time. */
interface Span {
  readonly fileId: FileId;
  readonly from: string;
  readonly to: string;
  /** Per kind, each key once, in clock order. */
  readonly kinds: ReadonlyMap<string, readonly Entry[]>;
}

function spanOf(fileId: FileId, events: readonly KeyedEvent[]): Span {
  const kinds = new Map<string, Entry[]>();
  // A key repeated within the file is blocked on its own already.
  const seen = new Set<string>();
  let from = "";
  let to = "";
  for (const event of events) {
    const clock = clockOf(event);
    if (from === "" || compareText(clock, from) < 0) from = clock;
    if (compareText(clock, to) > 0) to = clock;
    if (seen.has(event.key)) continue;
    seen.add(event.key);
    const list = kinds.get(event.kind) ?? [];
    list.push({ clock, key: event.key });
    kinds.set(event.kind, list);
  }
  for (const list of kinds.values()) {
    list.sort((a, b) => compareText(a.clock, b.clock));
  }
  return { fileId, from, to, kinds };
}

/** The first index whose clock is not before `clock`, or not after it. */
function bound(list: readonly Entry[], clock: string, past: boolean): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const order = compareText((list[mid] as Entry).clock, clock);
    if (order < 0 || (past && order === 0)) low = mid + 1;
    else high = mid;
  }
  return low;
}

function within(
  list: readonly Entry[] | undefined,
  from: string,
  to: string,
): readonly Entry[] {
  return list === undefined
    ? []
    : list.slice(bound(list, from, false), bound(list, to, true));
}

/** Whether two lists, each holding a key at most once, hold the same keys. */
function sameKeys(a: readonly Entry[], b: readonly Entry[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((entry) => entry.key));
  return b.every((entry) => keys.has(entry.key));
}

/**
 * Two files of one account, compared kind by kind over the time both
 * recorded, on the broker's own clock (ADR 0011). Where both hold events of
 * a kind, they must hold the same keys, or the files disagree about what
 * happened, and which is right is the user's call. Where only one holds
 * any, the other was likely exported without that kind: a warning, since a
 * missing kind cannot count twice. Two accounts taken for one disagree the
 * same way, which is how a wrong "same account" answer surfaces. The time a
 * file recorded is read from its events, as no export states it.
 */
function reconcile(events: readonly KeyedEvent[]): Diagnostic[] {
  const accounts = new Map<string, Map<FileId, KeyedEvent[]>>();
  for (const event of events) {
    const files =
      accounts.get(event.account) ?? new Map<FileId, KeyedEvent[]>();
    const list = files.get(event.source.fileId) ?? [];
    list.push(event);
    files.set(event.source.fileId, list);
    accounts.set(event.account, files);
  }
  const diagnostics: Diagnostic[] = [];
  for (const account of [...accounts.keys()].sort(compareText)) {
    const spans = [...(accounts.get(account) ?? [])]
      .sort(([a], [b]) => compareText(a, b))
      .map(([fileId, list]) => spanOf(fileId, list));
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const first = spans[i] as Span;
        const second = spans[j] as Span;
        const from =
          compareText(first.from, second.from) > 0 ? first.from : second.from;
        const to = compareText(first.to, second.to) < 0 ? first.to : second.to;
        if (compareText(from, to) > 0) continue;
        for (const kind of KINDS) {
          const a = within(first.kinds.get(kind), from, to);
          const b = within(second.kinds.get(kind), from, to);
          if (a.length === 0 && b.length === 0) continue;
          const params = {
            kind,
            from: dayOf(from),
            to: dayOf(to),
            first: fileRef(first.fileId),
            second: fileRef(second.fileId),
          };
          if (a.length === 0 || b.length === 0) {
            diagnostics.push(
              diagnostic("warning", "overlapKindMissing", params),
            );
          } else if (!sameKeys(a, b)) {
            diagnostics.push(diagnostic("blocking", "overlapMismatch", params));
          }
        }
      }
    }
  }
  return diagnostics;
}

/**
 * Two accounts of one broker that hold the same event. A trade's key holds
 * its time to the second, its quantity, its price and the broker's order
 * ID, so two real accounts never share one: the files are one account
 * taken for two, and every trade they share would count twice. That
 * blocks. Two real accounts holding as many shares of one fund are paid
 * alike, so a shared dividend is a warning. Splits are shared by every
 * account that held the security, and say nothing.
 */
function sharedAcrossAccounts(kept: readonly KeyedEvent[]): Diagnostic[] {
  const first = new Map<string, KeyedEvent>();
  const pairs = new Map<
    string,
    {
      kind: "trade" | "dividend";
      count: number;
      first: FileRef;
      second: FileRef;
    }
  >();
  for (const event of kept) {
    if (event.kind !== "trade" && event.kind !== "dividend") continue;
    const id = JSON.stringify([event.broker, event.kind, event.key]);
    const seen = first.get(id);
    if (seen === undefined) {
      first.set(id, event);
      continue;
    }
    // The accounts stay internal: a finding names files, never accounts.
    const pair = JSON.stringify([event.kind, seen.account, event.account]);
    const entry = pairs.get(pair) ?? {
      kind: event.kind,
      count: 0,
      first: fileRef(seen.source.fileId),
      second: fileRef(event.source.fileId),
    };
    entry.count += 1;
    pairs.set(pair, entry);
  }
  return [...pairs.values()].map((shared) =>
    diagnostic(
      shared.kind === "trade" ? "blocking" : "warning",
      "accountsShareEvents",
      shared,
    ),
  );
}

/**
 * Checks, deduplicates and reconciles a session's events. Of the reports of
 * one event, the one read first by file and row stands, so the names and
 * sources that come with it never depend on the order files were loaded. A
 * repeat from another file that says the same is the overlap: dropped, and
 * counted. A repeat within one file, or one that says something else,
 * blocks instead: one export never lists a row twice, and which of two
 * disagreeing reports is right is the user's call.
 *
 * `carried` is what reading the files found. It stays with the ledger, so
 * that a row an adapter refused withholds every form as surely as an event
 * refused here: a return built without that row would be wrong.
 */
export function validateLedger(
  input: readonly LedgerEvent[],
  carried: readonly Diagnostic[] = [],
): ValidatedLedger {
  if (input.length > LIMITS.eventsPerSession) {
    return sealed(
      [],
      inPlaceOrder([
        ...carried,
        diagnostic("blocking", "tooManyEvents", {
          limit: LIMITS.eventsPerSession,
        }),
      ]),
    );
  }
  const found: Diagnostic[] = [...carried];
  const checked: LedgerEvent[] = [];
  for (const event of input) {
    const problem = refusal(event);
    if (problem === null) checked.push(event);
    else found.push(problem);
  }
  checked.sort(bySource);

  const keyed = checked.filter((e): e is KeyedEvent => e.kind !== "ignored");
  const groups = new Map<string, KeyedEvent[]>();
  for (const event of keyed) {
    const id = eventId(event);
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [event]);
    else group.push(event);
  }
  let duplicates = 0;
  const survivors = new Set<KeyedEvent>();
  for (const group of groups.values()) {
    // In source order already: the first report stands.
    const [survivor, ...repeats] = group as [KeyedEvent, ...KeyedEvent[]];
    survivors.add(survivor);
    const files = new Set([survivor.source.fileId]);
    for (const report of repeats) {
      const where = identify(isinOf(report), report.date);
      if (files.has(report.source.fileId)) {
        found.push(
          diagnostic("blocking", "duplicateKeyInFile", where, report.source),
        );
      } else if (!sameContent(survivor, report)) {
        found.push(
          diagnostic("blocking", "duplicateKeyConflict", where, report.source),
        );
      } else {
        duplicates += 1;
      }
      files.add(report.source.fileId);
    }
  }
  // Pushed one by one: spread into a call, a long list overflows the stack.
  for (const d of reconcile(keyed)) found.push(d);
  for (const d of sharedAcrossAccounts(keyed.filter((e) => survivors.has(e)))) {
    found.push(d);
  }
  const diagnostics = inPlaceOrder(found);
  if (duplicates > 0) {
    diagnostics.unshift(
      diagnostic("info", "duplicatesRemoved", { count: duplicates }),
    );
  }
  return sealed(
    checked.filter((e) => e.kind === "ignored" || survivors.has(e)),
    diagnostics,
  );
}

/**
 * The ledger, frozen down to each event's parts, so that nothing holding an
 * event can change it after it passed: what FIFO and the forms read is what
 * was checked.
 */
function sealed(
  events: LedgerEvent[],
  diagnostics: Diagnostic[],
): ValidatedLedger {
  for (const event of events) {
    for (const part of Object.values(event)) {
      if (typeof part === "object" && part !== null) Object.freeze(part);
    }
    Object.freeze(event);
  }
  return Object.freeze({
    events: Object.freeze(events),
    diagnostics: Object.freeze(diagnostics),
  }) as ValidatedLedger;
}
