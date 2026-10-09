/**
 * The normalized ledger: what every broker adapter turns its export into
 * (ADR 0004, with the contract of ADR 0011). FX conversion, lot matching and
 * the forms work on these events only, so they are written and tested once,
 * whatever the broker.
 *
 * Every event keeps where it came from (an opaque file ID and a row), which
 * account it belongs to, and the broker's own clock; and every input row
 * becomes an event, an explicit ignored record, or a blocking diagnostic:
 * nothing is dropped silently (CLAUDE.md, "Tax correctness").
 */
import type { IsoDate } from "./dates.js";
import type { Decimal } from "./decimal.js";

export type { IsoDate };

declare const brand: unique symbol;
/** A string only one constructor may make: a cast elsewhere is a review flag. */
type Branded<B extends string> = string & { readonly [brand]: B };

/**
 * A file's identity: the first 16 hex digits of the SHA-256 of its bytes.
 * The app keeps the file's name beside it, in its own state; the pipeline
 * never sees the name, which can carry a client's name or an account number.
 */
export type FileId = Branded<"FileId">;

/**
 * The account of the taxpayer an event belongs to: `broker:` and an opaque
 * label. Identity and overlap checks are per account; FIFO never is.
 */
export type AccountScope = Branded<"AccountScope">;

/** An event's identity within its account, built only by `keyBuilder`. */
export type EventKey = Branded<"EventKey">;

/** Where an event came from. */
export interface SourceRef {
  readonly fileId: FileId;
  /**
   * 1-based within `part`: the row as a spreadsheet numbers it (CSV, XLSX),
   * or the record's position in its section (XML).
   */
  readonly row: number;
  /** The sheet or section, from the adapter's own closed set. */
  readonly part?: string;
}

/**
 * The broker's own clock for an event, kept beside the tax date derived from
 * it (`taxDate`): the date rule is an open FURS question, and keeping the
 * source makes changing it a policy change, not a re-import (ADR 0011).
 */
export interface BrokerTime {
  /** UTC to the second, "2026-03-01T01:10:00Z", where the broker gives one. */
  readonly instant: string | null;
  /** The calendar date the broker shows for the event, where it gives one. */
  readonly brokerDate: IsoDate | null;
}

/** An amount in a currency (ISO 4217, or a broker's minor-unit code such as GBX). */
export interface Money {
  readonly amount: Decimal;
  readonly currency: string;
}

/** The security an event concerns. FIFO and the forms key on the ISIN. */
export interface SecurityRef {
  readonly isin: string;
  readonly symbol?: string;
  readonly name?: string;
  /** A fund unit (ETF, UCITS) rather than a share: `IsFond` on Doh-KDVP. */
  readonly isFund?: boolean;
}

interface EventBase {
  /**
   * Identity within the account: the same row read from two overlapping
   * exports has the same key, two rows of one export never do.
   */
  readonly key: EventKey;
  readonly broker: string;
  readonly account: AccountScope;
  readonly source: SourceRef;
  readonly at: BrokerTime;
}

/** A purchase or sale on its trade date, never the settlement date. */
export interface TradeEvent extends EventBase {
  readonly kind: "trade";
  readonly side: "buy" | "sell";
  /** The trade (contract) date, as the date policy reads `at`. */
  readonly date: IsoDate;
  readonly security: SecurityRef;
  /** Always positive; the side says which way. */
  readonly quantity: Decimal;
  /**
   * Price per unit from the contract, without commission: costs are covered
   * by the 1% + 1% normed costs, not deducted (docs/research/04 §4.2).
   */
  readonly price: Money;
  /** Kept for the audit report; never part of the per-unit value. */
  readonly commission?: Money;
}

/**
 * A split or reverse split: `to` new shares for every `from` old ones. Not a
 * disposal (ZDoh-2 Art. 95(6)); open lots keep their dates and total cost.
 */
export interface SplitEvent extends EventBase {
  readonly kind: "split";
  /** The day the split takes effect: trades that day are post-split. */
  readonly date: IsoDate;
  readonly isin: string;
  readonly from: Decimal;
  readonly to: Decimal;
  /**
   * The shares the reporting broker's accounts gained (or, in a reverse
   * split, lost) by the split, where the broker reports that and not the
   * ratio itself (Interactive Brokers). FIFO checks the ratio against it.
   */
  readonly positionChange?: Decimal;
}

export interface DividendEvent extends EventBase {
  readonly kind: "dividend";
  /** The day the dividend was paid, which is also its rate date. */
  readonly date: IsoDate;
  readonly security: SecurityRef;
  /** The gross amount, before any tax withheld. */
  readonly gross: Money;
}

/**
 * Foreign tax withheld on a dividend, or a reversal of it (a negative
 * amount). Linked to its dividend by key, within one account, never by
 * guessing.
 */
export interface WithholdingEvent extends EventBase {
  readonly kind: "withholding";
  readonly date: IsoDate;
  readonly isin: string;
  /** The key of the dividend this tax belongs to, in the same account. */
  readonly dividendKey: EventKey;
  /** Positive when withheld, negative when refunded or reversed. */
  readonly amount: Money;
}

/** Why a row produced no event, for the "every row is accounted for" rule. */
export type IgnoredReason =
  | "deposit"
  | "withdrawal"
  /** Taxable, but on Doh-Obr, which this version does not build. */
  | "interest"
  | "currencyConversion"
  /** Spending with a broker's card, and its cashback: not capital income. */
  | "cardSpending"
  | "fee"
  /** Cash moved between the taxpayer's own accounts; securities never. */
  | "cashTransfer"
  | "header"
  /**
   * The second row of a pair whose first row carries the event, such as
   * the "open" half of a Trading 212 split.
   */
  | "pairedRow"
  /**
   * A row that totals or repeats others the same file holds in detail,
   * such as Interactive Brokers' summary, order and closed-lot rows.
   */
  | "summary"
  /** A dividend and the reversal that cancels it, both left out. */
  | "reversed"
  /**
   * Shares moved between accounts. A move creates and ends no lot: the
   * purchases come from the account's own history, and a sale without one
   * still blocks.
   */
  | "securitiesTransfer"
  /**
   * A derivative traded beside shares (an option, a future): taxed on
   * D-IFI, which this version does not build. Exercises and assignments,
   * which make share trades, are refused, never left out.
   */
  | "derivative";

export interface IgnoredRow {
  readonly kind: "ignored";
  readonly reason: IgnoredReason;
  readonly broker: string;
  readonly account: AccountScope;
  readonly source: SourceRef;
}

export type LedgerEvent =
  TradeEvent | SplitEvent | DividendEvent | WithholdingEvent | IgnoredRow;

/** Events of every kind except ignored rows: the ones with a key. */
export type KeyedEvent = Exclude<LedgerEvent, IgnoredRow>;
