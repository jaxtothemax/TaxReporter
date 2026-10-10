/**
 * Trading 212 Invest and ISA history exports (CSV), every header revision
 * the research found (docs/research/06-brokers-ibkr-t212-revolut.md §4).
 *
 * What it reads, and why:
 *
 * - **Columns by name**, never position: Trading 212 has moved them around
 *   at least twice. A column it does not know blocks the import if any row
 *   fills it, since its meaning could change an amount (06 §2.3).
 * - **Dates by the one date policy.** Rows carry UTC times, which the
 *   ledger keeps; the trade or payment date is what core's `taxDate` makes
 *   of them, for now the Slovenian calendar date of the instant (06 §2.2;
 *   ADR 0011 §7).
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
 *   The same split reported by another account is merged by the FIFO engine,
 *   which owns that rule.
 * - **Refused, not guessed:** actions whose tax treatment is not settled
 *   (payments in lieu, "tax exempted" dividends, transfers, spin-offs,
 *   stock distributions) and any action this adapter does not know.
 * - **Duplicates** across overlapping exports: T212 reuses order IDs and
 *   leaves them empty on dividends, so a row's key is built by core's key
 *   builder from its content, the time cut to the second, plus how many
 *   identical rows came before it in the same file (06 §2.5). Two identical
 *   fills stay two; the same fill in two files is one.
 * - **One account per file**, the group the user put it in: T212 exports
 *   do not name the account (ADR 0011 §4).
 */
import {
  accountGroup,
  Decimal,
  diagnostic,
  isIsin,
  keyBuilder,
  LIMITS,
  MAX_SPLIT_TERM,
  MAX_SPLITS,
  taxDate,
  untrusted,
  type BrokerTime,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type IgnoredReason,
  type IsoDate,
  type LedgerEvent,
  type NumberColumn,
  type SecurityRef,
  type SourceRef,
} from "@taxreporter/core";

import type { CsvAdapter, ImportResult, ReadContext } from "./adapter.js";
import type { CsvRow, CsvTable } from "./csv.js";
import { fromUtcStamp } from "./time.js";

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

/**
 * Cash paid per share under a label that is not "Dividend". Both are read as
 * ordinary dividends, which ZDoh-2 art. 90 makes of any distribution on the
 * basis of a holding that does not reduce it, with a warning on each row
 * (04 §7.1, §9.1; 06 §4.3). A "Bonus" in a real export was a company's
 * special cash dividend. A "Demerger" was cash paid instead of a fraction of
 * a spin-off share, whose treatment is not settled: counting it as a
 * dividend is the simplest reading, and the warning says so.
 */
const LABELLED_DIVIDENDS: ReadonlyMap<string, "bonus" | "demerger"> = new Map([
  ["Dividend (Bonus)", "bonus"],
  ["Dividend (Demerger)", "demerger"],
]);

/** Cash movements, which are part of neither return. */
const CASH: ReadonlyMap<string, IgnoredReason> = new Map([
  ["Deposit", "deposit"],
  ["Withdrawal", "withdrawal"],
  ["Currency conversion", "currencyConversion"],
  ["Card debit", "cardSpending"],
  ["Card credit", "cardSpending"],
  ["Card refund", "cardSpending"],
  ["Spending cashback", "cardSpending"],
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

/**
 * A number as T212 writes it: an optional minus, at most 15 whole digits
 * and 12 decimals. Each column's sign is checked where it is read.
 */
const NUMBER = new RegExp(
  `^-?\\d{1,${String(LIMITS.numberWholeDigits)}}(?:\\.\\d{1,${String(LIMITS.numberDecimals)}})?$`,
);

/**
 * Zero as T212 writes it in the two columns it keeps to 10 decimals (a
 * dividend's price to 6): "0E-10", the scientific form a decimal library
 * gives a zero with more than six places (7 to 12 here, the most NUMBER
 * takes). A real export priced both
 * rows of a takeover paid in shares this way (06 §4.2). Only zero, and only
 * in those columns: a value under 0.000001 would be written "1.234E-7", and
 * a tax or a total, kept to 2 decimals, wrote its zero as "0.00". The form
 * stays refused anywhere else until an export shows it.
 */
const ZERO_WITH_EXPONENT = /^0E-(?:[7-9]|1[0-2])$/;
const TEN_DECIMALS: ReadonlySet<NumberColumn> = new Set([
  "No. of shares",
  "Price / share",
]);

/** A plain decimal string as an exact fraction, numerator over 10^decimals. */
function fraction(text: string): readonly [bigint, bigint] {
  const [whole = "0", decimals = ""] = text.split(".");
  return [BigInt(whole + decimals), 10n ** BigInt(decimals.length)];
}

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

const MAX_TERM = BigInt(MAX_SPLIT_TERM);

/**
 * The split's ratio, `to` new shares for `from` old ones, from the position
 * before it and after it (plain decimal strings). Exact when the reduced
 * fraction after/before has whole terms up to MAX_SPLIT_TERM; otherwise the
 * simplest continued-fraction convergent that restates the position within
 * T212's rounding (10 decimals, 06 §4.2). Null when none fits, which blocks
 * rather than inventing a ratio. A few dozen steps at most, whatever the
 * input: it runs once per split pair in a file that may be hostile.
 */
export function splitRatio(
  before: string,
  after: string,
): { readonly from: Decimal; readonly to: Decimal } | null {
  const [bn, bd] = fraction(before);
  const [an, ad] = fraction(after);
  if (bn <= 0n || an <= 0n) return null;
  // after / before = (an / ad) / (bn / bd)
  const divisor = gcd(an * bd, ad * bn);
  const [p, q] = [(an * bd) / divisor, (ad * bn) / divisor];
  const ratio = (to: bigint, from: bigint) => ({
    from: Decimal.fromInteger(from),
    to: Decimal.fromInteger(to),
  });
  if (p <= MAX_TERM && q <= MAX_TERM) return ratio(p, q);
  // Convergents h/k of p/q, from the simplest on.
  let [h0, h1, k0, k1] = [0n, 1n, 1n, 0n];
  let [x, y] = [p, q];
  while (y !== 0n) {
    const a = x / y;
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (h1 > MAX_TERM || k1 > MAX_TERM) break;
    // |before x h/k - after| <= 10^-10, all in whole numbers.
    const off = bn * h1 * ad - an * k1 * bd;
    if (h1 > 0n && (off < 0n ? -off : off) * 10_000_000_000n <= bd * ad * k1) {
      return ratio(h1, k1);
    }
    [x, y] = [y, x % y];
  }
  return null;
}

interface SplitHalf {
  readonly source: SourceRef;
  readonly at: BrokerTime;
  readonly date: IsoDate;
  /** As written: the ratio is worked out on exact fractions. */
  readonly quantity: string;
  readonly total: Decimal | null;
}

/**
 * Currency codes as T212 writes them: ISO codes in capitals, and the pence
 * and cents codes the rate table scales. Never case-folded: GBp is not GBP,
 * and folding it would be a hundredfold error.
 */
const CURRENCY = /^[A-Z]{3}$/;
const MINOR_CURRENCIES = new Set(["GBp", "ZAc"]);

/** A cell that is not a number, by the adapter's own name for its column. */
class BadCell extends Error {
  constructor(readonly column: NumberColumn) {
    super(`Not a number in column ${column}`);
  }
}

function read(table: CsvTable, context: ReadContext): ImportResult {
  const account = accountGroup(TRADING212, context.accountGroup);
  const keys = keyBuilder();
  const events: LedgerEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  const header = table.header;

  for (const [index, name] of header.entries()) {
    if (isKnownColumn(name)) continue;
    if (table.rows.some((r) => (r.cells[index] ?? "") !== "")) {
      // The column's position, not its name: a header is file text, and
      // file text never goes into a diagnostic.
      diagnostics.push(
        diagnostic("blocking", "unknownColumn", {
          broker: TRADING212,
          position: index + 1,
          column: untrusted(name),
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
  // `header` is where the cell is; `column`, the name a finding gives it, so
  // that a header the file wrote, "Total (EUR)", never reaches one.
  const amount = (
    row: CsvRow,
    column: NumberColumn,
    header: string = column,
  ): Decimal | null => {
    const value = text(row, header);
    if (value === "") return null;
    // T212 writes plain decimals with up to 10 places, and a zero in a share
    // count or a price sometimes as "0E-10"; anything else, another exponent,
    // a comma, an absurd size, is not trusted as a number. A split reads a
    // share count's own text, which this zero never reaches: it is refused
    // as a quantity first.
    if (TEN_DECIMALS.has(column) && ZERO_WITH_EXPONENT.test(value)) {
      return Decimal.ZERO;
    }
    if (!NUMBER.test(value)) throw new BadCell(column);
    return Decimal.parse(value);
  };

  const fundsNoted = new Set<string>();
  const halves = new Map<string, { close: SplitHalf[]; open: SplitHalf[] }>();
  let interestRows = 0;
  let lastDate: string | null = null;

  for (const row of table.rows) {
    const source: SourceRef = { fileId: context.fileId, row: row.row };
    const block = <C extends DiagnosticCode>(
      code: C,
      params: DiagnosticParams[C],
    ) => {
      diagnostics.push(diagnostic("blocking", code, params, source));
    };
    const action = text(row, "Action");
    const at = fromUtcStamp(text(row, timeColumn));
    const dated = at === null ? null : taxDate(at);
    if (at === null || dated === null) {
      block("invalidTime", {});
      continue;
    }
    const date = dated.date;
    if (lastDate === null || date > lastDate) lastDate = date;

    const cash = CASH.get(action);
    if (cash !== undefined) {
      events.push({
        kind: "ignored",
        reason: cash,
        broker: TRADING212,
        account,
        source,
      });
      continue;
    }
    if (INTEREST.has(action)) {
      events.push({
        kind: "ignored",
        reason: "interest",
        broker: TRADING212,
        account,
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
    if (
      side === null &&
      !isSplit &&
      !DIVIDENDS.has(action) &&
      !LABELLED_DIVIDENDS.has(action)
    ) {
      // The action is file text: it travels only wrapped, for the screen,
      // and every export of the finding drops it.
      block("unknownAction", { broker: TRADING212, action: untrusted(action) });
      continue;
    }

    // Every action left concerns one security.
    const isin = text(row, "ISIN");
    if (!isIsin(isin)) {
      block("invalidIsin", {});
      continue;
    }
    // The policy's date decides the tax year, the rate and the 30-day
    // window; where it differs from the UTC date T212 shows, say so. Which
    // clock defines a trade date has no FURS source yet (research 06, open
    // questions).
    if (dated.moved) {
      diagnostics.push(
        diagnostic(
          "warning",
          "dateMovedToLjubljana",
          { date, utcDate: at.brokerDate ?? date },
          source,
        ),
      );
    }
    let quantity: Decimal | null;
    let price: Decimal | null;
    let tax: Decimal | null;
    let total: Decimal | null;
    try {
      quantity = amount(row, "No. of shares");
      price = amount(row, "Price / share");
      tax = amount(row, "Withholding tax");
      total = totalColumn === null ? null : amount(row, "Total", totalColumn);
    } catch (error) {
      if (!(error instanceof BadCell)) throw error;
      block("invalidNumber", { column: error.column });
      continue;
    }
    if (quantity === null || !quantity.isPositive()) {
      block("invalidQuantity", {});
      continue;
    }

    if (isSplit) {
      const pairAt = `${isin} ${at.instant ?? date}`;
      const pair = halves.get(pairAt) ?? { close: [], open: [] };
      pair[action === SPLIT_CLOSE ? "close" : "open"].push({
        source,
        at,
        date,
        quantity: text(row, "No. of shares"),
        total,
      });
      halves.set(pairAt, pair);
      continue;
    }

    const currency = text(row, "Currency (Price / share)");
    if (!CURRENCY.test(currency) && !MINOR_CURRENCIES.has(currency)) {
      block("invalidCurrency", {});
      continue;
    }
    // Zero is no price: a sale at 0 is a takeover paid in shares, which
    // needs the user's input (06 §4.3).
    if (price === null || !price.isPositive()) {
      block("invalidPrice", {});
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
        key: keys.key("trade", [
          action,
          at.instant,
          isin,
          quantity,
          price,
          currency,
          text(row, "ID"),
        ]),
        broker: TRADING212,
        account,
        source,
        at,
        side,
        date,
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
      block("dividendTaxCurrency", {});
      continue;
    }
    const labelled = LABELLED_DIVIDENDS.get(action);
    if (labelled !== undefined) {
      diagnostics.push(
        diagnostic(
          "warning",
          "dividendLabelTreated",
          { broker: TRADING212, label: labelled },
          source,
        ),
      );
    }
    const parts = [action, at.instant, isin, quantity, price, withheld];
    const key = keys.key("dividend", parts);
    events.push({
      kind: "dividend",
      key,
      broker: TRADING212,
      account,
      source,
      at,
      date,
      security,
      gross: { amount: quantity.times(price).plus(withheld), currency },
    });
    if (withheld.isPositive()) {
      events.push({
        kind: "withholding",
        key: keys.key("withholding", parts),
        broker: TRADING212,
        account,
        source,
        at,
        date,
        isin,
        dividendKey: key,
        amount: { amount: withheld, currency },
      });
    }
  }

  // More split pairs on one security than the engine takes are refused
  // before any ratio is worked out: no real history has them.
  const pairsPerIsin = new Map<string, number>();
  for (const at of halves.keys()) {
    const isin = at.slice(0, at.indexOf(" "));
    pairsPerIsin.set(isin, (pairsPerIsin.get(isin) ?? 0) + 1);
  }
  for (const [at, { close, open }] of halves) {
    const isin = at.slice(0, at.indexOf(" "));
    const rows = [...close, ...open];
    const refuse = <C extends DiagnosticCode>(
      code: C,
      params: DiagnosticParams[C],
    ) => {
      // Every row of a refused pair is accounted for by the refusal.
      for (const half of rows) {
        diagnostics.push(diagnostic("blocking", code, params, half.source));
      }
    };
    if ((pairsPerIsin.get(isin) ?? 0) > MAX_SPLITS) {
      refuse("tooManySplits", { isin });
      continue;
    }
    const [before] = close;
    const [after] = open;
    if (
      before === undefined ||
      after === undefined ||
      close.length > 1 ||
      open.length > 1
    ) {
      refuse("splitUnpaired", { isin });
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
      refuse(ratio === null ? "splitRatioUnclear" : "splitHalvesDisagree", {
        isin,
        date: before.date,
      });
      continue;
    }
    events.push(
      {
        kind: "split",
        key: keys.key("split", [isin, before.at.instant]),
        broker: TRADING212,
        account,
        source: before.source,
        at: before.at,
        date: before.date,
        isin,
        from: ratio.from,
        to: ratio.to,
      },
      {
        kind: "ignored",
        reason: "pairedRow",
        broker: TRADING212,
        account,
        source: after.source,
      },
    );
  }

  if (interestRows > 0) {
    diagnostics.push(
      diagnostic("warning", "interestNotCovered", {
        broker: TRADING212,
        count: interestRows,
      }),
    );
  }

  return {
    broker: TRADING212,
    format: `trading212-csv-${revision(header)}`,
    events,
    diagnostics,
    reach: lastDate === null ? [] : [{ account, lastDate }],
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
 * The CFD account's export, recognized by its `RecordType` column beside
 * T212's `Ticker`, so that it is refused by name: CFDs are derivatives,
 * filed on D-IFI, which this version does not build (06 §4.1). Another
 * broker's file with a `RecordType` column is no match: it is unknown.
 */
export const trading212Cfd: CsvAdapter = {
  broker: TRADING212,
  matches: (header) =>
    header.includes("RecordType") && header.includes("Ticker"),
  read: () => ({
    broker: TRADING212,
    format: "trading212-cfd-csv",
    events: [],
    diagnostics: [
      diagnostic("blocking", "derivativesNotSupported", {
        broker: TRADING212,
      }),
    ],
    reach: [],
  }),
};
