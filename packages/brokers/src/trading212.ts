/**
 * Trading 212 Invest and ISA history exports (CSV), every header revision
 * the research found (docs/research/06-brokers-ibkr-t212-revolut.md §4).
 *
 * What it reads, and why:
 *
 * - **Columns by name**, never position: Trading 212 has moved them around
 *   at least twice. A column it does not know blocks the import if any row
 *   fills it, since its meaning could change an amount (06 §2.3).
 * - **Dates in Ljubljana.** Rows carry UTC times; the trade or payment
 *   date is the Slovenian calendar date of that instant (06 §2.2).
 * - **Trades at the contract price**, in the instrument's currency (GBX for
 *   pence, which the rate lookup scales). Fees, T212's own exchange rate and
 *   its realized result are never used: costs are covered by the normed
 *   costs, and every conversion uses the BSI rate (06 §2.1; 04 §4.2).
 * - **Gross dividends** are shares times the price per share, which T212
 *   gives net of tax, plus the tax withheld (06 §4.3). The tax becomes its
 *   own withholding event, joined to the dividend by key.
 * - **Splits** come as a "close" row with the position before and an "open"
 *   row with the position after. Their ratio is the simplest whole-number
 *   one that turns one into the other; a pair that does not fit one blocks.
 *   The same split reported by another broker is merged by the FIFO engine,
 *   which owns that rule.
 * - **Refused, not guessed:** actions whose tax treatment is not settled
 *   (payments in lieu, "tax exempted" dividends, transfers, spin-offs,
 *   stock distributions) and any action this adapter does not know.
 * - **Duplicates** across overlapping exports: T212 reuses order IDs and
 *   leaves them empty on dividends, so a row's key is its content, the
 *   time cut to the second, plus how many identical rows came before it in
 *   the same file (06 §2.5). Two identical fills stay two; the same fill in
 *   two files is one.
 */
import {
  Decimal,
  diagnostic,
  isIsin,
  type Diagnostic,
  type DiagnosticCode,
  type IgnoredReason,
  type LedgerEvent,
  type SecurityRef,
  type SourceRef,
} from "@taxreporter/core";

import type { CsvAdapter, ImportResult } from "./adapter.js";
import type { CsvRow, CsvTable } from "./csv.js";
import { fromUtcStamp, type UtcStamp } from "./time.js";

export const TRADING212 = "trading212";

const BUYS = new Set(["Market buy", "Limit buy", "Stop buy", "Stop limit buy"]);
const SELLS = new Set([
  "Market sell",
  "Limit sell",
  "Stop sell",
  "Stop limit sell",
]);

/**
 * Dividends whose treatment is settled: ordinary dividends, and the
 * property income a REIT distributes (06 §4.3; 04 §7.1).
 */
const DIVIDENDS = new Set([
  "Dividend (Dividend)",
  "Dividend (Ordinary)",
  "Dividend (Dividends paid by us corporations)",
  "Dividend (Dividends paid by foreign corporations)",
  "Dividend (Property income distribution)",
]);

/** Cash movements, which are part of neither return. */
const CASH: ReadonlyMap<string, IgnoredReason> = new Map([
  ["Deposit", "deposit"],
  ["Withdrawal", "withdrawal"],
  ["Currency conversion", "currencyConversion"],
  ["Card debit", "other"],
  ["Card credit", "other"],
  ["Card refund", "other"],
  ["Spending cashback", "other"],
]);

/**
 * Interest, a fund's interest distribution included: taxable, but on
 * Doh-Obr, which this version does not build (04 §7.1, §8).
 */
const INTEREST = new Set([
  "Interest on cash",
  "Lending interest",
  "Dividend (Interest)",
]);

/** Known actions whose tax treatment is not settled (06 §4.3, §4.6). */
const UNSETTLED = new Set([
  "Dividend (Dividend manufactured payment)",
  "Dividend (Tax exempted)",
  "Dividend (Bonus)",
  "Dividend (Property income)",
  "Dividend adjustment",
  "Result adjustment",
  "Stock Split",
  "Spin off",
  "Stock distribution",
  "Custom stock distribution",
  "Transfer in",
  "Transfer out",
  "Equity rights",
]);

const SPLIT_CLOSE = "Stock split close";
const SPLIT_OPEN = "Stock split open";

/** Columns this adapter knows, read or deliberately left unread. */
const KNOWN_COLUMNS = new Set([
  "Action",
  "Time",
  "Time (UTC)",
  "ISIN",
  "Ticker",
  "Name",
  "Notes",
  "ID",
  "No. of shares",
  "Price / share",
  "Currency (Price / share)",
  "Exchange rate",
  "Result",
  "Currency (Result)",
  "Total",
  "Currency (Total)",
  "Withholding tax",
  "Currency (Withholding tax)",
  "Currency conversion from amount",
  "Currency (Currency conversion from amount)",
  "Currency conversion to amount",
  "Currency (Currency conversion to amount)",
  "Merchant name",
  "Merchant category",
]);

/**
 * Cost and result columns: "Name" with "Currency (Name)" beside it, or, in
 * the first revision, "Name (EUR)" with the currency in the header.
 */
const AMOUNT_COLUMNS = new Set([
  "Result",
  "Total",
  "Charge amount",
  "Transaction fee",
  "Finra fee",
  "Stamp duty",
  "Stamp duty reserve tax",
  "French transaction tax",
  "Currency conversion fee",
  "Deposit fee",
]);

/** "Total (EUR)" gives "Total"; anything else, null. */
function withoutCurrencySuffix(name: string): string | null {
  const open = name.length - 6;
  if (open < 1 || name.charAt(open) !== " " || !name.endsWith(")")) {
    return null;
  }
  if (name.charAt(open + 1) !== "(") return null;
  for (let i = open + 2; i < name.length - 1; i += 1) {
    const c = name.charCodeAt(i);
    if (c < 65 || c > 90) return null;
  }
  return name.slice(0, open);
}

function isKnownColumn(name: string): boolean {
  if (KNOWN_COLUMNS.has(name)) return true;
  if (AMOUNT_COLUMNS.has(name)) return true;
  if (name.startsWith("Currency (") && name.endsWith(")")) {
    return AMOUNT_COLUMNS.has(name.slice("Currency (".length, -1));
  }
  const base = withoutCurrencySuffix(name);
  return base !== null && AMOUNT_COLUMNS.has(base);
}

/** The header revisions of 06 §4.4. */
function revision(header: readonly string[]): string {
  if (header.includes("Time (UTC)")) return "v4";
  if (header.some((name) => withoutCurrencySuffix(name) === "Total")) {
    return "v1";
  }
  return header[header.indexOf("Name") + 1] === "Notes" ? "v3" : "v2";
}

/**
 * A fund unit, by the words "ETF" or "UCITS" in its name: exports carry no
 * fund flag, and the form asks for one (`IsFond`; dividend type 4). Said in
 * a note, so the user can see where it came from.
 */
const FUND_NAME = /\b(?:ETF|UCITS)\b/;

/** Ratios are whole numbers up to this on either side: real splits are. */
const MAX_SPLIT_TERM = 10_000;
/** T212 writes positions to 10 decimals, so a split rounds within this. */
const POSITION_ROUNDING = Decimal.parse("0.0000000001");

/**
 * The simplest ratio, `to` new shares for `from` old ones, that turns the
 * position before a split into the position after it: exactly if one does,
 * else within T212's rounding of the position. Null when none fits, which
 * blocks rather than inventing a ratio.
 */
export function splitRatio(
  before: Decimal,
  after: Decimal,
): { readonly from: Decimal; readonly to: Decimal } | null {
  if (!before.isPositive() || !after.isPositive()) return null;
  let close: { from: Decimal; to: Decimal } | null = null;
  for (let q = 1; q <= MAX_SPLIT_TERM; q += 1) {
    const from = Decimal.fromInteger(q);
    const to = after.times(from).dividedBy(before).round(0, "halfUp");
    if (
      !to.isPositive() ||
      to.greaterThan(Decimal.fromInteger(MAX_SPLIT_TERM))
    ) {
      continue;
    }
    const restated = before.times(to).dividedBy(from);
    if (restated.equals(after)) return { from, to };
    if (
      close === null &&
      restated.minus(after).abs().compare(POSITION_ROUNDING) <= 0
    ) {
      close = { from, to };
    }
  }
  return close;
}

interface SplitHalf {
  readonly source: SourceRef;
  readonly stamp: UtcStamp;
  readonly quantity: Decimal;
  readonly total: Decimal | null;
}

class BadCell extends Error {
  constructor(readonly column: string) {
    super(`Not a number in column ${column}`);
  }
}

function read(table: CsvTable, file: string): ImportResult {
  const events: LedgerEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  const header = table.header;

  for (const [index, name] of header.entries()) {
    if (isKnownColumn(name)) continue;
    if (table.rows.some((r) => (r.cells[index] ?? "") !== "")) {
      diagnostics.push(
        diagnostic("blocking", "unknownColumn", {
          broker: TRADING212,
          column: name.slice(0, 80),
        }),
      );
    }
  }

  const timeColumn = header.includes("Time (UTC)") ? "Time (UTC)" : "Time";
  const totalColumn =
    header.find((n) => n === "Total" || withoutCurrencySuffix(n) === "Total") ??
    null;
  const text = (row: CsvRow, column: string) => {
    const index = table.column(column);
    return index === undefined ? "" : (row.cells[index] ?? "");
  };
  const amount = (row: CsvRow, column: string): Decimal | null => {
    const value = text(row, column);
    if (value === "") return null;
    try {
      return Decimal.parse(value);
    } catch {
      throw new BadCell(column);
    }
  };

  const occurrences = new Map<string, number>();
  /** A key unique within the file, and the same for the same row in any file. */
  const keyOf = (...parts: readonly string[]) => {
    const content = parts.join("|");
    const n = (occurrences.get(content) ?? 0) + 1;
    occurrences.set(content, n);
    return `${TRADING212}|${content}|${String(n)}`;
  };
  const fundsNoted = new Set<string>();
  const halves = new Map<string, { close: SplitHalf[]; open: SplitHalf[] }>();
  let interestRows = 0;
  let lastDate: string | null = null;

  for (const row of table.rows) {
    const source: SourceRef = { file, row: row.row };
    const block = (
      code: DiagnosticCode,
      params: Record<string, string> = {},
    ) => {
      diagnostics.push(diagnostic("blocking", code, params, source));
    };
    const action = text(row, "Action");
    const stamp = fromUtcStamp(text(row, timeColumn));
    if (stamp === null) {
      block("invalidTime");
      continue;
    }
    if (lastDate === null || stamp.date > lastDate) lastDate = stamp.date;

    const cash = CASH.get(action);
    if (cash !== undefined) {
      events.push({
        kind: "ignored",
        reason: cash,
        broker: TRADING212,
        source,
      });
      continue;
    }
    if (INTEREST.has(action)) {
      events.push({
        kind: "ignored",
        reason: "interest",
        broker: TRADING212,
        source,
      });
      interestRows += 1;
      continue;
    }
    if (UNSETTLED.has(action)) {
      block("unsupportedAction", { broker: TRADING212, action });
      continue;
    }
    const side = BUYS.has(action) ? "buy" : SELLS.has(action) ? "sell" : null;
    const isSplit = action === SPLIT_CLOSE || action === SPLIT_OPEN;
    if (side === null && !isSplit && !DIVIDENDS.has(action)) {
      block("unknownAction", {
        broker: TRADING212,
        action: action.slice(0, 80),
      });
      continue;
    }

    // Every action left concerns one security.
    const isin = text(row, "ISIN");
    if (!isIsin(isin)) {
      block("invalidIsin");
      continue;
    }
    let quantity: Decimal | null;
    let price: Decimal | null;
    let tax: Decimal | null;
    let total: Decimal | null;
    try {
      quantity = amount(row, "No. of shares");
      price = amount(row, "Price / share");
      tax = amount(row, "Withholding tax");
      total = totalColumn === null ? null : amount(row, totalColumn);
    } catch (error) {
      if (!(error instanceof BadCell)) throw error;
      block("invalidNumber", { column: error.column });
      continue;
    }
    if (quantity === null || !quantity.isPositive()) {
      block("invalidQuantity");
      continue;
    }

    if (isSplit) {
      const pair = halves.get(`${isin} ${stamp.second}`) ?? {
        close: [],
        open: [],
      };
      pair[action === SPLIT_CLOSE ? "close" : "open"].push({
        source,
        stamp,
        quantity,
        total,
      });
      halves.set(`${isin} ${stamp.second}`, pair);
      continue;
    }

    const currency = text(row, "Currency (Price / share)");
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      block("invalidCurrency");
      continue;
    }
    // Zero is no price: a sale at 0 is a takeover paid in shares, which
    // needs the user's input (06 §4.3).
    if (price === null || !price.isPositive()) {
      block("invalidPrice");
      continue;
    }

    const name = text(row, "Name");
    const ticker = text(row, "Ticker");
    const isFund = FUND_NAME.test(name);
    if (isFund && !fundsNoted.has(isin)) {
      fundsNoted.add(isin);
      diagnostics.push(diagnostic("info", "fundFromName", { isin }));
    }
    const security: SecurityRef = {
      isin,
      ...(ticker === "" ? {} : { symbol: ticker }),
      ...(name === "" ? {} : { name }),
      ...(isFund ? { isFund: true } : {}),
    };

    if (side !== null) {
      events.push({
        kind: "trade",
        key: keyOf(
          action,
          stamp.second,
          isin,
          quantity.toString(),
          price.toString(),
          currency,
          text(row, "ID"),
        ),
        broker: TRADING212,
        source,
        side,
        date: stamp.date,
        security,
        quantity,
        price: { amount: price, currency },
      });
      continue;
    }

    // A dividend: the price per share is net of the tax withheld.
    const withheld = tax ?? Decimal.ZERO;
    if (withheld.isNegative()) {
      block("unexpectedSign", { column: "Withholding tax" });
      continue;
    }
    if (
      withheld.isPositive() &&
      text(row, "Currency (Withholding tax)") !== currency
    ) {
      block("dividendTaxCurrency");
      continue;
    }
    const key = keyOf(
      action,
      stamp.second,
      isin,
      quantity.toString(),
      price.toString(),
      withheld.toString(),
    );
    events.push({
      kind: "dividend",
      key,
      broker: TRADING212,
      source,
      date: stamp.date,
      security,
      gross: { amount: quantity.times(price).plus(withheld), currency },
    });
    if (withheld.isPositive()) {
      events.push({
        kind: "withholding",
        key: `${key}|tax`,
        broker: TRADING212,
        source,
        date: stamp.date,
        isin,
        dividendKey: key,
        amount: { amount: withheld, currency },
      });
    }
  }

  for (const [at, { close, open }] of halves) {
    const isin = at.slice(0, at.indexOf(" "));
    const [before] = close;
    const [after] = open;
    if (
      before === undefined ||
      after === undefined ||
      close.length > 1 ||
      open.length > 1
    ) {
      for (const half of [...close, ...open]) {
        diagnostics.push(
          diagnostic("blocking", "splitUnpaired", { isin }, half.source),
        );
      }
      continue;
    }
    const ratio = splitRatio(before.quantity, after.quantity);
    // Both halves carry the position's value; a pair that disagrees on it
    // is not one split (06 §4.6).
    const agree =
      before.total === null ||
      after.total === null ||
      before.total.equals(after.total);
    if (ratio === null || !agree) {
      diagnostics.push(
        diagnostic(
          "blocking",
          ratio === null ? "splitRatioUnclear" : "splitHalvesDisagree",
          { isin, date: before.stamp.date },
          before.source,
        ),
      );
      continue;
    }
    events.push(
      {
        kind: "split",
        key: `${TRADING212}|split|${isin}|${before.stamp.second}`,
        broker: TRADING212,
        source: before.source,
        date: before.stamp.date,
        isin,
        from: ratio.from,
        to: ratio.to,
      },
      {
        kind: "ignored",
        reason: "pairedRow",
        broker: TRADING212,
        source: after.source,
      },
    );
  }

  if (interestRows > 0) {
    diagnostics.push(
      diagnostic("warning", "interestNotCovered", {
        broker: TRADING212,
        count: String(interestRows),
      }),
    );
  }

  return {
    broker: TRADING212,
    format: `trading212-csv-${revision(header)}`,
    events,
    diagnostics,
    lastDate,
  };
}

/** Trading 212 Invest and ISA history exports. */
export const trading212: CsvAdapter = {
  broker: TRADING212,
  matches: (header) =>
    header.includes("Action") &&
    (header.includes("Time") || header.includes("Time (UTC)")) &&
    header.includes("ISIN") &&
    header.includes("No. of shares") &&
    header.includes("Price / share") &&
    !header.includes("RecordType"),
  read,
};

/**
 * The CFD account's export, recognized by its `RecordType` column so that it
 * is refused by name: CFDs are derivatives, filed on D-IFI, which this
 * version does not build (06 §4.1).
 */
export const trading212Cfd: CsvAdapter = {
  broker: TRADING212,
  matches: (header) => header.includes("RecordType"),
  read: () => ({
    broker: TRADING212,
    format: "trading212-cfd-csv",
    events: [],
    diagnostics: [
      diagnostic("blocking", "derivativesNotSupported", {
        broker: TRADING212,
      }),
    ],
    lastDate: null,
  }),
};
