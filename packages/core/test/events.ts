/** Ledger events for the engine's tests: one security, made-up trades. */
import { Decimal } from "../src/decimal.js";
import type {
  AccountScope,
  EventKey,
  FileId,
  LedgerEvent,
  SplitEvent,
  TradeEvent,
} from "../src/ledger.js";
import { validateLedger, type ValidatedLedger } from "../src/validate.js";

let row = 0;

export const ISIN = "US0378331005";

/**
 * A key of the key builder's shape, 128 bits in hex: from a number, as the
 * helpers below number their events, or from a short name, which can never
 * equal a numbered one.
 */
export function key(of: number | string): EventKey {
  const hex =
    typeof of === "number"
      ? of.toString(16).padStart(32, "0")
      : hexOf(of).padEnd(32, "0");
  return hex.slice(0, 32) as EventKey;
}

/** A short ASCII name's character codes in hex. */
function hexOf(name: string): string {
  let hex = "";
  for (let i = 0; i < name.length; i += 1) {
    hex += name.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

/** A file ID of intake's shape, from a short name: "a" is "6100000000000000". */
export function fileId(name: string): FileId {
  return hexOf(name).padEnd(16, "0").slice(0, 16) as FileId;
}

/** A Trading 212-style account: its broker and the group number, from 1. */
export function account(broker: string, group = 1): AccountScope {
  return `${broker}:${String(group)}` as AccountScope;
}

/** One file per account: the broker's own for group 1. */
function fileOf(broker: string, group: string): FileId {
  return fileId(group === "1" ? broker : `g${group}${broker}`);
}

/**
 * A trade with no time of day, in the default file and account of its
 * broker. Overrides replace fields as given, so one that changes the date,
 * the broker or the account changes the clock, the account or the file too.
 */
export function trade(
  side: "buy" | "sell",
  date: string,
  quantity: string,
  price = "100",
  overrides: Partial<TradeEvent> = {},
): TradeEvent {
  row += 1;
  const broker = overrides.broker ?? "ibkr";
  const scope = overrides.account ?? account(broker);
  const group = scope.slice(scope.indexOf(":") + 1);
  return {
    kind: "trade",
    key: key(row),
    broker,
    account: scope,
    source: { fileId: fileOf(broker, group), row },
    at: { instant: null, brokerDate: overrides.date ?? date },
    side,
    date,
    security: { isin: ISIN, symbol: "AAPL" },
    quantity: Decimal.parse(quantity),
    price: { amount: Decimal.parse(price), currency: "USD" },
    ...overrides,
  };
}

/** A split in its broker's default file, or in a file of its own account. */
export function split(
  date: string,
  from: string,
  to: string,
  broker = "ibkr",
  group = 1,
): SplitEvent {
  row += 1;
  return {
    kind: "split",
    key: key(row),
    broker,
    account: account(broker, group),
    source: { fileId: fileOf(broker, String(group)), row },
    at: { instant: null, brokerDate: date },
    date,
    isin: ISIN,
    from: Decimal.parse(from),
    to: Decimal.parse(to),
  };
}

/**
 * The ledger the engine takes, from events that have to pass the checks as
 * they are: a test of the engine is never a test of the checks before it.
 */
export function validated(events: readonly LedgerEvent[]): ValidatedLedger {
  const ledger = validateLedger(events);
  if (ledger.diagnostics.length > 0) {
    const codes = ledger.diagnostics.map((d) => d.code).join(", ");
    throw new Error(`The events did not pass validateLedger: ${codes}`);
  }
  return ledger;
}
