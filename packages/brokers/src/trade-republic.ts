/**
 * Trade Republic's transaction export (CSV), the one revision known, from
 * April 2026 (docs/research/07-brokers-eu-and-others.md §4.2; ADR 0015).
 *
 * What it reads, and why:
 *
 * - **Recognized by its exact header**, 23 named columns: a revision that
 *   adds or drops one is a new format, not read on a guess until it has
 *   its own fixture.
 * - **Dates by the one date policy.** `datetime` is a UTC instant, which
 *   the ledger keeps; `date` is the Berlin calendar date, which is the
 *   Ljubljana one too. A row whose two disagree cannot be dated, and is
 *   refused.
 * - **Trades** (`BUY`, `SELL`, a savings plan's `SAVINGS_PLAN_EXECUTED`) of
 *   shares and funds, at `price` in `currency`; a sale's `shares` are
 *   negative, a purchase's positive. Fees and the cash `amount` are never
 *   used: costs are covered by the normed costs, as for every broker
 *   (04 §4.2). `asset_class` says which security is a fund.
 * - **Cash rows** that are part of neither return (deposits, withdrawals,
 *   card spending) are ignored by reason; interest is ignored with a
 *   warning, as it belongs on Doh-Obr.
 * - **Refused, not guessed:** dividends, until a real export confirms what
 *   `amount`, `tax` and `original_amount` hold on them (07 §4.2, a medium
 *   confidence reading); free shares (Saveback, stock perks, bonuses),
 *   whose cost basis is a tax question; corporate actions, deliveries and
 *   migrations; bonds, private markets and crypto; and any row this adapter
 *   does not know.
 * - **Keys** by `transaction_id`, which Trade Republic never reuses, and
 *   without an ordinal (ADR 0011 §5): the same row in an overlapping
 *   export is read once, and a row repeated inside one file blocks as a
 *   repeat instead of counting twice.
 * - **A trade's figures are checked:** its cash `amount` must be its
 *   quantity times its price, give or take its fee and a cent, and a trade
 *   with a foreign leg (`original_amount`, `original_currency`, `fx_rate`)
 *   is refused until a real export shows which currency its price is in.
 * - **One account:** `account_type` names the kind of account, and only
 *   `DEFAULT` is known. Every file is taken for the one taxpayer's account,
 *   so overlapping exports are read once, whatever the user answers about
 *   other brokers' unnamed accounts; a second person's export added by
 *   mistake would be read as the same account (ADR 0011 §4, ADR 0015).
 */
import {
  accountScope,
  Decimal,
  diagnostic,
  isIsin,
  isIsoDate,
  keyOf,
  LIMITS,
  taxDate,
  untrusted,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type IgnoredReason,
  type LedgerEvent,
  type SecurityRef,
  type SourceRef,
} from "@taxreporter/core";

import type { CsvAdapter, ImportResult, ReadContext } from "./adapter.js";
import type { CsvRow, CsvTable } from "./csv.js";
import { fromUtcStamp } from "./time.js";

export const TRADE_REPUBLIC = "traderepublic";

/** The export's columns, in the order it writes them (07 §4.2). */
export const TRADE_REPUBLIC_COLUMNS = [
  "datetime",
  "date",
  "account_type",
  "category",
  "type",
  "asset_class",
  "name",
  "symbol",
  "shares",
  "price",
  "amount",
  "fee",
  "tax",
  "currency",
  "original_amount",
  "original_currency",
  "fx_rate",
  "description",
  "transaction_id",
  "counterparty_name",
  "counterparty_iban",
  "payment_reference",
  "mcc_code",
] as const;

/** The one account a known export names. */
const ACCOUNT_TYPE = "DEFAULT";

const BUYS = new Set(["BUY", "SAVINGS_PLAN_EXECUTED"]);
const SELLS = new Set(["SELL"]);

/** Securities whose purchase and sale go on Doh-KDVP: shares and funds. */
const ASSET_CLASSES = new Set(["STOCK", "FUND"]);

/** Cash movements, part of neither return. */
const CASH: ReadonlyMap<string, IgnoredReason> = new Map([
  ["CUSTOMER_INBOUND", "deposit"],
  ["CUSTOMER_INPAYMENT", "deposit"],
  ["TRANSFER_INSTANT_INBOUND", "deposit"],
  ["CUSTOMER_OUTBOUND_REQUEST", "withdrawal"],
  ["TRANSFER_INSTANT_OUTBOUND", "withdrawal"],
  ["CARD_TRANSACTION", "cardSpending"],
  ["CARD_TRANSACTION_INTERNATIONAL", "cardSpending"],
]);

/** Interest: taxable, but on Doh-Obr, which this version does not build. */
const INTEREST = new Set(["INTEREST_PAYMENT"]);

/**
 * Rows known and refused, each named by this list, never by the file: free
 * shares, whose cost basis is a tax question; corporate actions and moves
 * of securities, which are not read on a guess (07 §4.2).
 */
const UNSETTLED = new Set([
  "BENEFITS_SAVEBACK",
  "STOCKPERK",
  "BONUS",
  "MIGRATION",
  "REDEMPTION",
  "FINAL_MATURITY",
  "PRIVATE_MARKET_BUY",
]);

/** Categories whose every row is a corporate action or a delivery. */
const UNSETTLED_CATEGORIES = new Set(["CORPORATE_ACTION", "DELIVERY"]);

/**
 * Dividends: their treatment is settled, but not what this export's
 * columns hold on them, which no source confirms yet (07 §4.2).
 */
const UNCONFIRMED = new Set(["DIVIDEND"]);

/** A plain decimal, an optional minus, as Trade Republic writes them. */
const NUMBER = new RegExp(
  `^-?\\d{1,${String(LIMITS.numberWholeDigits)}}(?:\\.\\d{1,${String(LIMITS.numberDecimals)}})?$`,
);
const CURRENCY = /^[A-Z]{3}$/;
const CENT = Decimal.parse("0.01");

function read(table: CsvTable, context: ReadContext): ImportResult {
  const account = accountScope(TRADE_REPUBLIC, ACCOUNT_TYPE);
  const events: LedgerEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  // Every column is there: the header matched them all.
  const text = (
    row: CsvRow,
    column: (typeof TRADE_REPUBLIC_COLUMNS)[number],
  ) => {
    const index = table.column(column);
    return index === undefined ? "" : (row.cells[index] ?? "");
  };
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
    const ignore = (reason: IgnoredReason) => {
      events.push({
        kind: "ignored",
        reason,
        broker: TRADE_REPUBLIC,
        account,
        source,
      });
    };

    // The instant in UTC, and the day Trade Republic gives it in Berlin,
    // which shares Ljubljana's time zone: the two must agree.
    const stamp = fromUtcStamp(text(row, "datetime"));
    const brokerDate = text(row, "date");
    if (stamp === null || !isIsoDate(brokerDate)) {
      block("invalidTime", {});
      continue;
    }
    const at = { instant: stamp.instant, brokerDate };
    const dated = taxDate(at);
    if (dated === null || dated.moved) {
      block("invalidTime", {});
      continue;
    }
    const date = dated.date;
    if (lastDate === null || date > lastDate) lastDate = date;

    const category = text(row, "category");
    const type = text(row, "type");
    if (text(row, "account_type") !== ACCOUNT_TYPE) {
      block("unknownAction", {
        broker: TRADE_REPUBLIC,
        action: untrusted(text(row, "account_type")),
      });
      continue;
    }
    // Cash only as cash: a cash type on a row that names a security, or in
    // another category, is no row this adapter knows.
    const isCash =
      category === "CASH" &&
      text(row, "symbol") === "" &&
      text(row, "shares") === "";
    const cash = CASH.get(type);
    if (cash !== undefined || INTEREST.has(type)) {
      if (!isCash) {
        block("unknownAction", {
          broker: TRADE_REPUBLIC,
          action: untrusted(type),
        });
        continue;
      }
      if (cash !== undefined) {
        ignore(cash);
      } else {
        ignore("interest");
        interestRows += 1;
      }
      continue;
    }
    if (UNSETTLED.has(type)) {
      block("unsupportedAction", { broker: TRADE_REPUBLIC, action: type });
      continue;
    }
    if (UNSETTLED_CATEGORIES.has(category)) {
      block("unsupportedAction", {
        broker: TRADE_REPUBLIC,
        action: category,
      });
      continue;
    }
    if (UNCONFIRMED.has(type)) {
      block("unconfirmedAction", { broker: TRADE_REPUBLIC, action: type });
      continue;
    }
    const side = BUYS.has(type) ? "buy" : SELLS.has(type) ? "sell" : null;
    if (side === null || category !== "TRADING") {
      // The type is file text: it travels only wrapped, for the screen.
      block("unknownAction", {
        broker: TRADE_REPUBLIC,
        action: untrusted(type),
      });
      continue;
    }
    const assetClass = text(row, "asset_class");
    if (!ASSET_CLASSES.has(assetClass)) {
      // Bonds, private markets, crypto: not shares or fund units.
      block("unsupportedAction", {
        broker: TRADE_REPUBLIC,
        action: ASSET_CLASS_NAMES.get(assetClass) ?? "other asset",
      });
      continue;
    }

    const isin = text(row, "symbol");
    if (!isIsin(isin)) {
      block("invalidIsin", {});
      continue;
    }
    const sharesText = text(row, "shares");
    const priceText = text(row, "price");
    if (!NUMBER.test(sharesText)) {
      block("invalidNumber", { column: "shares" });
      continue;
    }
    if (!NUMBER.test(priceText)) {
      block("invalidNumber", { column: "price" });
      continue;
    }
    const shares = Decimal.parse(sharesText);
    // A sale's shares leave the account, so they are written negative.
    if (shares.isZero() || shares.isNegative() !== (side === "sell")) {
      block("unexpectedSign", { column: "shares" });
      continue;
    }
    const price = Decimal.parse(priceText);
    if (!price.isPositive()) {
      block("invalidPrice", {});
      continue;
    }
    const currency = text(row, "currency");
    if (!CURRENCY.test(currency)) {
      block("invalidCurrency", {});
      continue;
    }
    // A foreign leg: the price may then be in another currency than
    // `currency` says, which no source settles yet (07 §4.2).
    if (
      text(row, "original_amount") !== "" ||
      text(row, "original_currency") !== "" ||
      text(row, "fx_rate") !== ""
    ) {
      block("unconfirmedAction", {
        broker: TRADE_REPUBLIC,
        action: "foreign-currency trade",
      });
      continue;
    }
    const amountText = text(row, "amount");
    const feeText = text(row, "fee");
    if (!NUMBER.test(amountText)) {
      block("invalidNumber", { column: "amount" });
      continue;
    }
    if (feeText !== "" && !NUMBER.test(feeText)) {
      block("invalidNumber", { column: "fee" });
      continue;
    }
    const quantity = shares.abs();
    // The cash moved is the quantity at the price, with or without the
    // fee: a price in another unit, or another trade's amount, shows here.
    const fee = feeText === "" ? Decimal.ZERO : Decimal.parse(feeText).abs();
    const off = quantity
      .times(price)
      .minus(Decimal.parse(amountText).abs())
      .abs();
    if (off.greaterThan(fee.plus(CENT))) {
      block("tradeInconsistent", { isin, date, check: "amount" });
      continue;
    }
    const name = text(row, "name");
    const security: SecurityRef = {
      isin,
      ...(name === "" ? {} : { name }),
      ...(assetClass === "FUND" ? { isFund: true } : {}),
    };
    events.push({
      kind: "trade",
      key: keyOf("trade", [
        text(row, "transaction_id"),
        type,
        at.instant,
        isin,
        quantity,
        price,
        currency,
      ]),
      broker: TRADE_REPUBLIC,
      account,
      source,
      at,
      side,
      date,
      security,
      quantity,
      price: { amount: price, currency },
    });
  }

  if (interestRows > 0) {
    diagnostics.push(
      diagnostic("warning", "interestNotCovered", {
        broker: TRADE_REPUBLIC,
        count: interestRows,
      }),
    );
  }

  return {
    broker: TRADE_REPUBLIC,
    format: "traderepublic-csv-2026",
    events,
    diagnostics,
    reach: lastDate === null ? [] : [{ account, lastDate }],
  };
}

/** Asset classes refused, by the names a finding gives them. */
const ASSET_CLASS_NAMES: ReadonlyMap<string, string> = new Map([
  ["BOND", "BOND"],
  ["PRIVATE_FUND", "PRIVATE_FUND"],
  ["CRYPTO", "CRYPTO"],
]);

/** Trade Republic's transaction export: its exact 23 columns, in any order. */
export const tradeRepublic: CsvAdapter = {
  broker: TRADE_REPUBLIC,
  matches: (header) =>
    header.length === TRADE_REPUBLIC_COLUMNS.length &&
    TRADE_REPUBLIC_COLUMNS.every((name) => header.includes(name)),
  read,
};
