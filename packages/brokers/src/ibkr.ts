/**
 * Interactive Brokers Activity Flex Query statements (XML), as research 06
 * §3 documents them, read through the import contract (ADR 0011) and the
 * rules of ADR 0012.
 *
 * What it reads, and why:
 *
 * - **The whole file first.** The scanner refuses anything but plain
 *   elements and attributes; events are made only once it has read the
 *   whole file, so a file cut short yields none.
 * - **Every section is known.** The sections holding transactions are
 *   read; the ones that only summarize them are skipped whole; any other
 *   blocks, so a section IBKR adds can never drop rows unseen.
 * - **One account per statement**, scoped by a hash of its ID. A row naming
 *   another account, a paper account, or more accounts than one taxpayer
 *   has, blocks.
 * - **Executions only.** Summary, order and closed-lot rows repeat them and
 *   are set aside; a statement holding only those blocks.
 * - **Trades at the contract price.** IBKR's own exchange rates, cost and
 *   P&L are never read (06 §2.1). Cancellations, corrections, book trades,
 *   exercises and short sales are refused, never netted on a guess.
 * - **The exchange date as IBKR states it**, with no time of day (06 §2;
 *   ADR 0011 §7).
 * - **Keys from IBKR's transaction IDs**, which it never reuses: a row
 *   repeated in one file is blocked as a repeat, never counted twice.
 * - **Withholding joins its dividend** only within its statement, by ISIN,
 *   currency, pay date and IBKR's action ID where both carry it. None or
 *   several candidates block (06 §3.4). A dividend and the reversal that
 *   cancels it are set aside together, with their tax.
 * - **Splits** come with the shares they added; the ratio is read from
 *   IBKR's wording and checked against them by the FIFO engine. Every other
 *   corporate action blocks.
 * - **No personal fields.** Names, addresses, aliases and descriptions of
 *   cash rows are never read; IDs go only into hashed keys and scopes.
 */
import {
  accountScope,
  Decimal,
  diagnostic,
  isIsin,
  keyOf,
  LIMITS,
  taxDate,
  untrusted,
  type AccountScope,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type DividendEvent,
  type IgnoredReason,
  type IsoDate,
  type LedgerEvent,
  type NumberColumn,
  type SecurityRef,
  type SourceRef,
} from "@taxreporter/core";

import type { ImportResult, ReadContext, XmlAdapter } from "./adapter.js";
import { scanXml, type XmlElement } from "./xml.js";

export const IBKR = "ibkr";

/** The children each read section may hold. */
const RECORDS: Readonly<Record<string, readonly string[]>> = {
  Trades: ["Trade", "Lot"],
  CorporateActions: ["CorporateAction"],
  CashTransactions: ["CashTransaction"],
  Transfers: ["Transfer"],
  SecuritiesInfo: ["SecurityInfo"],
};

/**
 * Sections that summarize, value or forecast what the read sections list
 * as transactions, so skipping them leaves no transaction out.
 */
const SKIPPED = new Set([
  "OpenPositions",
  "CashReport",
  "EquitySummaryInBase",
  "ChangeInNAV",
  "FIFOPerformanceSummaryInBase",
  "MTMPerformanceSummaryInBase",
  "MTDYTDPerformanceSummary",
  "StmtFunds",
  "ChangeInPositionValues",
  "NetStockPositionSummary",
  "ConversionRates",
  "InterestAccruals",
  "TierInterestDetails",
  "PriorPeriodPositions",
  "ChangeInDividendAccruals",
  "OpenDividendAccruals",
  "UnsettledTransfers",
  "TransactionTaxes",
  "UnbundledCommissionDetails",
  "FxTransactions",
  "OptionEAE",
  "TradeConfirms",
  "ComplexPositions",
  "SLBOpenContracts",
  "SLBActivities",
  "SLBFees",
  "HardToBorrowDetails",
  "ClientFees",
  "ClientFeesDetail",
  "DebitCardActivities",
  "SalesTaxes",
  "PendingExcercises",
  "RoutingCommissions",
  "LinkedAccounts",
  "IncentiveCouponAccrualDetails",
]);

/** Individual and joint IBKR accounts; DU is a paper (simulated) account. */
const ACCOUNT_ID = /^U\d{5,10}$/;
const PAPER_ID = /^DU\d{4,10}$/;
/** IBKR's default date, optionally with ";HHmmss" (06 §3.1). */
const IB_DATE = /^(\d{4})(\d{2})(\d{2})(?:;\d{6})?$/;
const TRANSACTION_ID = /^\d{1,20}$/;
const CURRENCY = /^[A-Z]{3}$/;
/** As T212's: a minus, at most 15 whole digits and 12 decimals. */
const NUMBER = new RegExp(
  `^-?\\d{1,${String(LIMITS.numberWholeDigits)}}(?:\\.\\d{1,${String(LIMITS.numberDecimals)}})?$`,
);
/**
 * "AAPL(US0378331005) SPLIT 4 FOR 1 (AAPL, …)": `to` new shares for `from`
 * old ones. Anchored, and every part bounded, so it runs in linear time.
 */
const SPLIT_WORDING =
  /^[^()]{1,64}\(([A-Z0-9]{12})\) SPLIT (\d{1,5}) FOR (\d{1,5}) \(/;

/** Asset categories IBKR uses for derivatives (06 §3.3). */
const DERIVATIVES = new Set([
  "OPT",
  "FUT",
  "FOP",
  "CFD",
  "FXCFD",
  "WAR",
  "IOPT",
]);
/** Securities this version does not file yet. */
const NOT_YET = new Set(["BOND", "BILL", "CMDTY", "CRYPTO"]);
const SHARES = new Set(["STK", "FUND"]);
/** Trades that are real executions (fractional ones included). */
const EXECUTIONS = new Set(["ExchTrade", "FracShare"]);
/** Trade types refused: they amend or move positions rather than trade. */
const AMENDING = new Set([
  "TradeCancel",
  "TradeCorrect",
  "FracShareCancel",
  "BookTrade",
  "DvpTrade",
]);
/** Note codes marking a trade as cancelled, corrected, reversed, exercised or assigned. */
const REFUSED_NOTES = new Set(["Ca", "Co", "Re", "A", "Ex", "Ep"]);
/** Levels of detail that repeat or total executions. */
const SUMMARY_TRADES = new Set(["ORDER", "SYMBOL_SUMMARY", "ASSET_SUMMARY"]);

/** The dividend labels taken as dividends; any other label blocks. */
const DIVIDEND_LABELS = new Set([
  "Ordinary Dividend",
  "Bonus Dividend",
  "Special Dividend",
]);
/** Labels known to be something else, refused by name. */
const OTHER_LABELS: ReadonlyMap<string, string> = new Map([
  ["Return of Capital", "returnOfCapital"],
  ["Capital Gain", "capitalGainDistribution"],
  ["Interest", "interestDistribution"],
  ["Limited Partnership", "partnershipDistribution"],
  ["Non-Dividend Distribution", "nonDividendDistribution"],
]);

/** Corporate action types (06 §3.5) refused, by their own code. */
const CORPORATE_ACTIONS = new Set([
  "FI",
  "CS",
  "SO",
  "SD",
  "TC",
  "TO",
  "TI",
  "IC",
  "DW",
  "BM",
  "RI",
  "SR",
  "DI",
  "ED",
  "HI",
  "HD",
  "CD",
  "CO",
  "CC",
  "CA",
  "CI",
  "BC",
  "CP",
  "PI",
  "PC",
  "OR",
  "GV",
  "FA",
  "TM",
  "UE",
]);

const CASH_IGNORED: ReadonlyMap<string, IgnoredReason> = new Map([
  ["Broker Interest Received", "interest"],
  ["Broker Interest Paid", "interest"],
  ["Bond Interest Received", "interest"],
  ["Bond Interest Paid", "interest"],
  ["Other Fees", "fee"],
  ["Advisor Fees", "fee"],
  ["Commission Adjustments", "fee"],
]);
const DEPOSITS = new Set([
  "Deposits/Withdrawals",
  "Deposits & Withdrawals",
  "Deposits",
]);

/** One record of a read section, as the scan found it. */
interface Recorded {
  readonly section: string;
  readonly element: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly source: SourceRef;
}

/** One FlexStatement: one account's records over its period. */
interface Statement {
  readonly attributes: ReadonlyMap<string, string>;
  readonly records: Recorded[];
  /** Account IDs its AccountInformation names. */
  readonly informed: string[];
}

/** The calendar date of an IBKR date, or null when it is not one. */
function ibDate(text: string | undefined): IsoDate | null {
  const match = text === undefined ? null : IB_DATE.exec(text);
  if (match === null) return null;
  const [, year, month, day] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  const date = `${year}-${month}-${day}`;
  return taxDate({ instant: null, brokerDate: date })?.date ?? null;
}

const daysBetween = (from: IsoDate, to: IsoDate) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
  86_400_000;

/**
 * Text from the file fit for a name: control, format and separator
 * characters become spaces, runs of space one, and it is cut to `length`
 * characters. The forms clean names again; the review shows these.
 */
function clean(text: string | undefined, length: number): string | undefined {
  if (text === undefined) return undefined;
  const plain = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  const cut = Array.from(plain).slice(0, length).join("");
  return cut === "" ? undefined : cut;
}

/** "(Ordinary Dividend)" at the end of a cash row's description. */
function dividendLabel(description: string | undefined): string | null {
  if (description === undefined || !description.endsWith(")")) return null;
  const open = description.lastIndexOf("(");
  return open < 0 ? null : description.slice(open + 1, -1);
}

function read(text: string, context: ReadContext): ImportResult {
  const events: LedgerEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  const statements: Statement[] = [];
  const rows = new Map<string, number>();
  // One object, as the scan's callbacks set these: a plain `let` would be
  // narrowed to its first value where the code after the scan reads it.
  const scan: {
    declared: number | null;
    current: Statement | null;
    section: string | null;
    /** Depth of a skipped element, while inside it. */
    skipping: number | null;
  } = { declared: null, current: null, section: null, skipping: null };

  const block = <C extends DiagnosticCode>(
    code: C,
    params: DiagnosticParams[C],
    source?: SourceRef,
  ) => {
    diagnostics.push(diagnostic("blocking", code, params, source));
  };
  /** An element no rule covers: said once, and nothing inside it is read. */
  const unknown = (element: XmlElement) => {
    block("unknownElement", { element: untrusted(element.name) });
    scan.skipping = element.depth;
  };

  scanXml(text, {
    open(element) {
      const { name, depth, attributes } = element;
      if (scan.skipping !== null) return;
      if (depth === 1) return; // FlexQueryResponse, matched already
      if (depth === 2) {
        if (name !== "FlexStatements") {
          unknown(element);
          return;
        }
        const count = attributes.get("count");
        scan.declared =
          count !== undefined && /^\d{1,4}$/.test(count) ? Number(count) : null;
        return;
      }
      if (depth === 3) {
        if (name !== "FlexStatement") {
          unknown(element);
          return;
        }
        scan.current = { attributes, records: [], informed: [] };
        statements.push(scan.current);
        return;
      }
      if (scan.current === null) {
        unknown(element);
        return;
      }
      if (depth === 4) {
        if (name === "AccountInformation") {
          scan.current.informed.push(attributes.get("accountId") ?? "");
          return;
        }
        if (SKIPPED.has(name)) {
          scan.skipping = depth;
          return;
        }
        if (RECORDS[name] === undefined) {
          unknown(element);
          return;
        }
        scan.section = name;
        return;
      }
      if (depth === 5 && scan.section !== null) {
        if (!(RECORDS[scan.section] ?? []).includes(name)) {
          unknown(element);
          return;
        }
        const row = (rows.get(scan.section) ?? 0) + 1;
        rows.set(scan.section, row);
        scan.current.records.push({
          section: scan.section,
          element: name,
          attributes,
          source: { fileId: context.fileId, row, part: scan.section },
        });
        return;
      }
      unknown(element);
    },
    close(name, depth) {
      if (scan.skipping === depth) scan.skipping = null;
      if (depth === 4 && name === scan.section) scan.section = null;
    },
  });

  if (scan.declared !== statements.length) {
    block("statementCountMismatch", {
      declared: scan.declared ?? 0,
      found: statements.length,
    });
  }
  const accounts = new Set(
    statements.map((s) => s.attributes.get("accountId") ?? ""),
  );
  if (accounts.size > LIMITS.accountsPerFile) {
    block("tooManyAccounts", { limit: LIMITS.accountsPerFile });
    return result([], diagnostics, []);
  }

  const reach = new Map<AccountScope, IsoDate>();
  let interest = 0;
  let derivatives = 0;
  for (const statement of statements) {
    const outcome = readStatement(statement, context, events, block);
    if (outcome === null) continue;
    interest += outcome.interest;
    derivatives += outcome.derivatives;
    const seen = reach.get(outcome.account);
    if (seen === undefined || outcome.toDate > seen) {
      reach.set(outcome.account, outcome.toDate);
    }
  }
  if (interest > 0) {
    diagnostics.push(
      diagnostic("warning", "interestNotCovered", {
        broker: IBKR,
        count: interest,
      }),
    );
  }
  if (derivatives > 0) {
    diagnostics.push(
      diagnostic("warning", "derivativesNotCovered", {
        broker: IBKR,
        count: derivatives,
      }),
    );
  }
  return result(
    events,
    diagnostics,
    [...reach].map(([account, lastDate]) => ({ account, lastDate })),
  );
}

function result(
  events: LedgerEvent[],
  diagnostics: Diagnostic[],
  reach: ImportResult["reach"],
): ImportResult {
  return { broker: IBKR, format: "ibkr-flex-xml", events, diagnostics, reach };
}

type Block = <C extends DiagnosticCode>(
  code: C,
  params: DiagnosticParams[C],
  source?: SourceRef,
) => void;

/**
 * One statement's events. Null when the statement as a whole is refused,
 * with the finding that says why: its rows are then not read at all.
 */
function readStatement(
  statement: Statement,
  context: ReadContext,
  events: LedgerEvent[],
  block: Block,
): {
  readonly account: AccountScope;
  readonly toDate: IsoDate;
  readonly interest: number;
  readonly derivatives: number;
} | null {
  const attributes = statement.attributes;
  const accountId = attributes.get("accountId") ?? "";
  if (PAPER_ID.test(accountId)) {
    block("paperAccount", {});
    return null;
  }
  if (!ACCOUNT_ID.test(accountId)) {
    block("accountIdInvalid", {});
    return null;
  }
  if (statement.informed.some((id) => id !== accountId)) {
    block("accountMismatch", {});
    return null;
  }
  const fromDate = ibDate(attributes.get("fromDate"));
  const toDate = ibDate(attributes.get("toDate"));
  const generated = ibDate(attributes.get("whenGenerated"));
  if (fromDate === null || toDate === null || generated === null) {
    block("unsupportedDateFormat", {});
    return null;
  }
  if (
    fromDate > toDate ||
    toDate > generated ||
    daysBetween(fromDate, toDate) > 366
  ) {
    block("statementPeriodInvalid", {});
    return null;
  }
  const account = accountScope(IBKR, accountId);
  const securities = new Map<string, ReadonlyMap<string, string>>();
  for (const record of statement.records) {
    if (record.section !== "SecuritiesInfo") continue;
    const isin = record.attributes.get("isin");
    if (isin !== undefined && isIsin(isin))
      securities.set(isin, record.attributes);
  }

  const ignore = (reason: IgnoredReason, source: SourceRef) => {
    events.push({ kind: "ignored", reason, broker: IBKR, account, source });
  };
  const counts = {
    executions: 0,
    summaryTrades: 0,
    details: 0,
    summaryCash: 0,
  };
  let interest = 0;
  let derivatives = 0;
  const cash: Recorded[] = [];
  const actions: Recorded[] = [];

  for (const record of statement.records) {
    const a = record.attributes;
    const rowAccount = a.get("accountId");
    if (rowAccount !== undefined && rowAccount !== accountId) {
      block("accountMismatch", {}, record.source);
      continue;
    }
    switch (record.section) {
      case "SecuritiesInfo":
        break;
      case "Transfers":
        ignore("securitiesTransfer", record.source);
        break;
      case "CorporateActions":
        if (a.get("levelOfDetail") === "SUMMARY") {
          ignore("summary", record.source);
        } else {
          actions.push(record);
        }
        break;
      case "CashTransactions": {
        const level = a.get("levelOfDetail");
        if (level === "SUMMARY") {
          counts.summaryCash += 1;
          ignore("summary", record.source);
        } else if (level === "DETAIL") {
          counts.details += 1;
          cash.push(record);
        } else {
          block(
            "unknownDetailLevel",
            { level: untrusted(level ?? "") },
            record.source,
          );
        }
        break;
      }
      case "Trades": {
        if (record.element === "Lot") {
          ignore("summary", record.source);
          break;
        }
        const level = a.get("levelOfDetail");
        if (level !== undefined && SUMMARY_TRADES.has(level)) {
          counts.summaryTrades += 1;
          ignore("summary", record.source);
          break;
        }
        if (level !== "EXECUTION") {
          block(
            "unknownDetailLevel",
            { level: untrusted(level ?? "") },
            record.source,
          );
          break;
        }
        counts.executions += 1;
        const category = a.get("assetCategory") ?? "";
        if (DERIVATIVES.has(category)) {
          derivatives += 1;
          ignore("derivative", record.source);
          break;
        }
        if (category === "CASH") {
          ignore("currencyConversion", record.source);
          break;
        }
        if (NOT_YET.has(category)) {
          block(
            "unsupportedAction",
            { broker: IBKR, action: category },
            record.source,
          );
          break;
        }
        if (!SHARES.has(category)) {
          block(
            "unknownAction",
            { broker: IBKR, action: untrusted(category) },
            record.source,
          );
          break;
        }
        const trade = readTrade(record, account, generated, securities, block);
        if (trade !== null) events.push(trade);
        break;
      }
    }
  }
  if (counts.summaryTrades > 0 && counts.executions === 0) {
    block("summaryOnly", { section: "Trades" });
  }
  if (counts.summaryCash > 0 && counts.details === 0) {
    block("summaryOnly", { section: "CashTransactions" });
  }
  interest += readCash(cash, account, generated, events, block, ignore);
  readCorporateActions(actions, account, generated, events, block);
  return { account, toDate, interest, derivatives };
}

/** A decimal attribute, or a finding naming the attribute. */
function number(
  a: ReadonlyMap<string, string>,
  column: NumberColumn,
  source: SourceRef,
  block: Block,
): Decimal | null {
  const text = a.get(column);
  if (text === undefined || !NUMBER.test(text)) {
    block("invalidNumber", { column }, source);
    return null;
  }
  return Decimal.parse(text);
}

function readTrade(
  record: Recorded,
  account: AccountScope,
  generated: IsoDate,
  securities: ReadonlyMap<string, ReadonlyMap<string, string>>,
  block: Block,
): LedgerEvent | null {
  const a = record.attributes;
  const source = record.source;
  const type = a.get("transactionType") ?? "";
  if (AMENDING.has(type)) {
    block("unsupportedAction", { broker: IBKR, action: type }, source);
    return null;
  }
  if (!EXECUTIONS.has(type)) {
    block("unknownAction", { broker: IBKR, action: untrusted(type) }, source);
    return null;
  }
  const notes = (a.get("notes") ?? "").split(";");
  const refusedNote = notes.find((note) => REFUSED_NOTES.has(note));
  if (refusedNote !== undefined) {
    block(
      "unsupportedAction",
      { broker: IBKR, action: `notes ${refusedNote}` },
      source,
    );
    return null;
  }
  const buySell = a.get("buySell");
  if (buySell !== "BUY" && buySell !== "SELL") {
    block(
      "unknownAction",
      { broker: IBKR, action: untrusted(buySell ?? "") },
      source,
    );
    return null;
  }
  const openClose = a.get("openCloseIndicator");
  const short =
    openClose === "C;O" ||
    (buySell === "SELL" && openClose === "O") ||
    (buySell === "BUY" && openClose === "C");
  if (short) {
    block("unsupportedAction", { broker: IBKR, action: "shortSale" }, source);
    return null;
  }
  const isin = a.get("isin") ?? "";
  const date = ibDate(a.get("tradeDate"));
  const where = {
    ...(isIsin(isin) ? { isin } : {}),
    ...(date === null ? {} : { date }),
  };
  if (!isIsin(isin)) {
    block("invalidIsin", {}, source);
    return null;
  }
  if (date === null) {
    block("invalidTime", {}, source);
    return null;
  }
  if (date > generated) {
    block("rowAfterStatement", where, source);
    return null;
  }
  const id = a.get("transactionID") ?? "";
  if (!TRANSACTION_ID.test(id)) {
    block("invalidTrade", where, source);
    return null;
  }
  const quantity = number(a, "quantity", source, block);
  const price = number(a, "tradePrice", source, block);
  if (quantity === null || price === null) return null;
  if (quantity.isZero()) {
    block("invalidQuantity", {}, source);
    return null;
  }
  if (quantity.isNegative() !== (buySell === "SELL")) {
    block("tradeInconsistent", { ...where, check: "sign" }, source);
    return null;
  }
  if (!price.isPositive()) {
    block("invalidPrice", {}, source);
    return null;
  }
  const multiplier = a.get("multiplier");
  if (multiplier !== undefined && multiplier !== "1") {
    block("tradeInconsistent", { ...where, check: "multiplier" }, source);
    return null;
  }
  const money = a.get("tradeMoney");
  if (money !== undefined) {
    const amount = number(a, "tradeMoney", source, block);
    if (amount === null) return null;
    // IBKR rounds tradeMoney to the cent; more than that is no rounding.
    const off = quantity.times(price).abs().minus(amount.abs()).abs();
    if (off.greaterThan(Decimal.parse("0.01"))) {
      block("tradeInconsistent", { ...where, check: "amount" }, source);
      return null;
    }
  }
  // A US or Canadian ISIN holds the CUSIP between country and check digit.
  const cusip = a.get("cusip");
  const cusipBased = isin.startsWith("US") || isin.startsWith("CA");
  if (
    cusipBased &&
    cusip !== undefined &&
    cusip !== "" &&
    isin.slice(2, 11) !== cusip
  ) {
    block("tradeInconsistent", { ...where, check: "cusip" }, source);
    return null;
  }
  const currency = a.get("currency") ?? "";
  if (!CURRENCY.test(currency)) {
    block("invalidCurrency", {}, source);
    return null;
  }
  const info = securities.get(isin);
  const subCategory = a.get("subCategory") ?? info?.get("subCategory");
  const symbol = clean(a.get("symbol"), 20);
  const name = clean(a.get("description") ?? info?.get("description"), 100);
  const fund = a.get("assetCategory") === "FUND" || subCategory === "ETF";
  const security: SecurityRef = {
    isin,
    ...(symbol === undefined ? {} : { symbol }),
    ...(name === undefined ? {} : { name }),
    ...(fund ? { isFund: true } : {}),
  };
  const commissionText = a.get("ibCommission");
  const commissionCurrency = a.get("ibCommissionCurrency");
  const commission =
    commissionText !== undefined &&
    NUMBER.test(commissionText) &&
    commissionCurrency !== undefined &&
    CURRENCY.test(commissionCurrency)
      ? { amount: Decimal.parse(commissionText), currency: commissionCurrency }
      : undefined;
  return {
    kind: "trade",
    key: keyOf("trade", [id]),
    broker: IBKR,
    account,
    source,
    at: { instant: null, brokerDate: date },
    side: buySell === "BUY" ? "buy" : "sell",
    date,
    security,
    quantity: quantity.abs(),
    price: { amount: price, currency },
    ...(commission === undefined ? {} : { commission }),
  };
}

/** A cash row as the joins see it. */
interface CashRow {
  readonly record: Recorded;
  readonly id: string;
  readonly isin: string;
  readonly currency: string;
  readonly date: IsoDate;
  readonly amount: Decimal;
  readonly actionID: string | undefined;
}

/**
 * Dividends, the tax withheld on them, and the cash rows set aside. Returns
 * how many interest rows there were, for the note that they are left out.
 */
function readCash(
  records: readonly Recorded[],
  account: AccountScope,
  generated: IsoDate,
  events: LedgerEvent[],
  block: Block,
  ignore: (reason: IgnoredReason, source: SourceRef) => void,
): number {
  let interest = 0;
  const dividends: CashRow[] = [];
  const withheld: CashRow[] = [];
  for (const record of records) {
    const a = record.attributes;
    const source = record.source;
    const type = a.get("type") ?? "";
    const ignored = CASH_IGNORED.get(type);
    if (ignored !== undefined) {
      if (
        type === "Broker Interest Received" ||
        type === "Bond Interest Received"
      ) {
        interest += 1;
      }
      ignore(ignored, source);
      continue;
    }
    if (DEPOSITS.has(type)) {
      const amount = a.get("amount") ?? "";
      ignore(amount.startsWith("-") ? "withdrawal" : "deposit", source);
      continue;
    }
    if (type === "Payment In Lieu Of Dividends") {
      block("unsupportedAction", { broker: IBKR, action: type }, source);
      continue;
    }
    if (type !== "Dividends" && type !== "Withholding Tax") {
      block("unknownAction", { broker: IBKR, action: untrusted(type) }, source);
      continue;
    }
    const isin = a.get("isin") ?? "";
    // Tax with no security to it is tax on interest: Doh-Obr's, not ours.
    if (
      type === "Withholding Tax" &&
      isin === "" &&
      (a.get("conid") ?? "") === ""
    ) {
      ignore("interest", source);
      continue;
    }
    const date = ibDate(a.get("dateTime") ?? a.get("reportDate"));
    const where = {
      ...(isIsin(isin) ? { isin } : {}),
      ...(date === null ? {} : { date }),
    };
    if (!isIsin(isin)) {
      block("invalidIsin", {}, source);
      continue;
    }
    if (date === null) {
      block("invalidTime", {}, source);
      continue;
    }
    if (date > generated) {
      block("rowAfterStatement", where, source);
      continue;
    }
    const id = a.get("transactionID") ?? "";
    if (!TRANSACTION_ID.test(id)) {
      block(
        type === "Dividends" ? "invalidDividend" : "invalidWithholding",
        where,
        source,
      );
      continue;
    }
    const amount = number(a, "amount", source, block);
    if (amount === null) continue;
    if (amount.isZero()) {
      block("invalidNumber", { column: "amount" }, source);
      continue;
    }
    const currency = a.get("currency") ?? "";
    if (!CURRENCY.test(currency)) {
      block("invalidCurrency", {}, source);
      continue;
    }
    if (type === "Dividends") {
      const label = dividendLabel(a.get("description"));
      if (label !== null && !DIVIDEND_LABELS.has(label)) {
        const known = OTHER_LABELS.get(label);
        if (known === undefined) {
          block(
            "unknownAction",
            { broker: IBKR, action: untrusted(label) },
            source,
          );
        } else {
          block("unsupportedAction", { broker: IBKR, action: known }, source);
        }
        continue;
      }
    }
    const row = {
      record,
      id,
      isin,
      currency,
      date,
      amount,
      actionID: a.get("actionID"),
    };
    (type === "Dividends" ? dividends : withheld).push(row);
  }

  // A reversal cancels the latest dividend before it of the same amount.
  const reversedBy = new Map<CashRow, CashRow>();
  const reversed = new Set<CashRow>();
  /** Rows refused already: neither filed nor anything's join target. */
  const refused = new Set<CashRow>();
  for (const reversal of dividends.filter((d) => d.amount.isNegative())) {
    const original = dividends
      .filter(
        (d) =>
          !d.amount.isNegative() &&
          !reversed.has(d) &&
          d.isin === reversal.isin &&
          d.currency === reversal.currency &&
          d.amount.equals(reversal.amount.negated()) &&
          d.date <= reversal.date,
      )
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))[0];
    if (original === undefined) {
      block(
        "dividendReversalUnmatched",
        { isin: reversal.isin, date: reversal.date },
        reversal.record.source,
      );
      refused.add(reversal);
      continue;
    }
    reversed.add(original).add(reversal);
    reversedBy.set(original, reversal);
  }

  // Tax joins the dividend row it was booked with: one statement, one
  // security, one currency, one day, one action where both name it.
  const taxOf = new Map<CashRow, CashRow[]>();
  for (const tax of withheld) {
    const candidates = dividends.filter(
      (d) =>
        d.isin === tax.isin &&
        d.currency === tax.currency &&
        d.date === tax.date &&
        (tax.actionID === undefined ||
          d.actionID === undefined ||
          d.actionID === tax.actionID),
    );
    const where = { isin: tax.isin, date: tax.date };
    if (candidates.length === 0) {
      block("withholdingUnlinked", where, tax.record.source);
      continue;
    }
    if (candidates.length > 1) {
      block("withholdingAmbiguous", where, tax.record.source);
      continue;
    }
    const dividend = candidates[0] as CashRow;
    if (refused.has(dividend)) {
      // Tax on a refused row is refused with it, never dropped.
      block("withholdingUnlinked", where, tax.record.source);
      continue;
    }
    taxOf.set(dividend, [...(taxOf.get(dividend) ?? []), tax]);
  }

  // A reversed pair is set aside with its tax, which has to cancel too.
  for (const [original, reversal] of reversedBy) {
    const taxes = [
      ...(taxOf.get(original) ?? []),
      ...(taxOf.get(reversal) ?? []),
    ];
    const net = Decimal.sum(taxes.map((t) => t.amount));
    if (!net.isZero()) {
      block(
        "dividendReversalUnmatched",
        { isin: original.isin, date: reversal.date },
        reversal.record.source,
      );
      continue;
    }
    for (const row of [original, reversal, ...taxes]) {
      events.push({
        kind: "ignored",
        reason: "reversed",
        broker: IBKR,
        account,
        source: row.record.source,
      });
    }
  }

  for (const dividend of dividends) {
    if (reversed.has(dividend) || refused.has(dividend)) continue;
    const security = securityOf(dividend);
    const event: DividendEvent = {
      kind: "dividend",
      key: keyOf("dividend", [dividend.id]),
      broker: IBKR,
      account,
      source: dividend.record.source,
      at: { instant: null, brokerDate: dividend.date },
      date: dividend.date,
      security,
      gross: { amount: dividend.amount, currency: dividend.currency },
    };
    events.push(event);
    for (const tax of taxOf.get(dividend) ?? []) {
      events.push({
        kind: "withholding",
        key: keyOf("withholding", [tax.id]),
        broker: IBKR,
        account,
        source: tax.record.source,
        at: { instant: null, brokerDate: tax.date },
        date: tax.date,
        isin: tax.isin,
        dividendKey: event.key,
        // IBKR books tax withheld as a negative amount, a refund positive.
        amount: { amount: tax.amount.negated(), currency: tax.currency },
      });
    }
  }
  return interest;
}

function securityOf(row: CashRow): SecurityRef {
  const symbol = clean(row.record.attributes.get("symbol"), 20);
  return { isin: row.isin, ...(symbol === undefined ? {} : { symbol }) };
}

/** Forward and reverse splits that keep the ISIN; every other action blocks. */
function readCorporateActions(
  records: readonly Recorded[],
  account: AccountScope,
  generated: IsoDate,
  events: LedgerEvent[],
  block: Block,
): void {
  const isinsOf = new Map<string, Set<string>>();
  for (const record of records) {
    const action = record.attributes.get("actionID");
    if (action === undefined) continue;
    const isins = isinsOf.get(action) ?? new Set<string>();
    isins.add(record.attributes.get("isin") ?? "");
    isinsOf.set(action, isins);
  }
  for (const record of records) {
    const a = record.attributes;
    const source = record.source;
    const type = a.get("type") ?? "";
    if (CORPORATE_ACTIONS.has(type)) {
      block(
        "unsupportedAction",
        { broker: IBKR, action: `corporateAction ${type}` },
        source,
      );
      continue;
    }
    if (type !== "FS" && type !== "RS") {
      block("unknownAction", { broker: IBKR, action: untrusted(type) }, source);
      continue;
    }
    const action = a.get("actionID") ?? "";
    if ((isinsOf.get(action)?.size ?? 0) > 1) {
      block(
        "unsupportedAction",
        { broker: IBKR, action: "isinChange" },
        source,
      );
      continue;
    }
    const isin = a.get("isin") ?? "";
    const date = ibDate(a.get("dateTime") ?? a.get("reportDate"));
    const where = {
      ...(isIsin(isin) ? { isin } : {}),
      ...(date === null ? {} : { date }),
    };
    const wording = SPLIT_WORDING.exec(a.get("description") ?? "");
    const quantity = a.get("quantity");
    if (
      !isIsin(isin) ||
      date === null ||
      !TRANSACTION_ID.test(action) ||
      wording === null ||
      wording[1] !== isin ||
      quantity === undefined ||
      !NUMBER.test(quantity)
    ) {
      block("invalidSplit", where, source);
      continue;
    }
    if (date > generated) {
      block("rowAfterStatement", where, source);
      continue;
    }
    const [, , to, from] = wording as unknown as [
      string,
      string,
      string,
      string,
    ];
    events.push({
      kind: "split",
      key: keyOf("split", [action]),
      broker: IBKR,
      account,
      source,
      at: { instant: null, brokerDate: date },
      date,
      isin,
      from: Decimal.parse(from),
      to: Decimal.parse(to),
      positionChange: Decimal.parse(quantity),
    });
  }
}

/** Interactive Brokers Activity Flex Query statements. */
export const ibkr: XmlAdapter = {
  broker: IBKR,
  matches: (root) =>
    root.name === "FlexQueryResponse" && root.attributes.get("type") === "AF",
  read,
};
