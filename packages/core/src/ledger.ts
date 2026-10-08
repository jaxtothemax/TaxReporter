/**
 * The normalized ledger: what every broker adapter turns its export into
 * (ADR 0004). FX conversion, lot matching and the forms work on these events
 * only, so they are written and tested once, whatever the broker.
 *
 * Every event keeps where it came from (file and row), and every input row
 * becomes an event, an explicit ignored record, or a blocking diagnostic:
 * nothing is dropped silently (CLAUDE.md, "Tax correctness").
 */
import type { IsoDate } from "./dates.js";
import type { Decimal } from "./decimal.js";

export type { IsoDate };

/** Where an event came from: a file and a 1-based row or record number. */
export interface SourceRef {
  /**
   * A label for the file, chosen by the app: its base name, never a path.
   * A name can still carry an account number or a client's name, so it is
   * shown to the user and nowhere else (see diagnostics.ts).
   */
  readonly file: string;
  readonly row: number;
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
   * Stable identity for deduplication, unique within the broker: the same
   * trade read from two overlapping exports of one account has the same
   * key, and two rows of one export never do (ADR 0004). The engine pairs it
   * with `broker`, so two brokers' keys never collide.
   */
  readonly key: string;
  readonly broker: string;
  readonly source: SourceRef;
}

/** A purchase or sale on its trade date, never the settlement date. */
export interface TradeEvent extends EventBase {
  readonly kind: "trade";
  readonly side: "buy" | "sell";
  /** The trade (contract) date. */
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
 * amount). Linked to its dividend by key, never by guessing.
 */
export interface WithholdingEvent extends EventBase {
  readonly kind: "withholding";
  readonly date: IsoDate;
  readonly isin: string;
  /** The key of the dividend this tax belongs to. */
  readonly dividendKey: string;
  /** Positive when withheld, negative when refunded or reversed. */
  readonly amount: Money;
}

/** Why a row produced no event, for the "every row is accounted for" rule. */
export type IgnoredReason =
  | "deposit"
  | "withdrawal"
  | "interest"
  | "currencyConversion"
  | "fee"
  | "transfer"
  | "header"
  /**
   * The second row of a pair whose first row carries the event, such as
   * the "open" half of a Trading 212 split.
   */
  | "pairedRow"
  | "other";

export interface IgnoredRow {
  readonly kind: "ignored";
  readonly reason: IgnoredReason;
  readonly broker: string;
  readonly source: SourceRef;
}

export type LedgerEvent =
  TradeEvent | SplitEvent | DividendEvent | WithholdingEvent | IgnoredRow;
