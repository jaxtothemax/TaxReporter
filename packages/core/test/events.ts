/** Ledger events for the engine's tests: one security, made-up trades. */
import { Decimal } from "../src/decimal.js";
import type { SplitEvent, TradeEvent } from "../src/ledger.js";

let row = 0;

export const ISIN = "US0378331005";

export function trade(
  side: "buy" | "sell",
  date: string,
  quantity: string,
  price = "100",
  overrides: Partial<TradeEvent> = {},
): TradeEvent {
  row += 1;
  return {
    kind: "trade",
    key: `t${String(row)}`,
    broker: "ibkr",
    source: { file: "test.csv", row },
    side,
    date,
    security: { isin: ISIN, symbol: "AAPL" },
    quantity: Decimal.parse(quantity),
    price: { amount: Decimal.parse(price), currency: "USD" },
    ...overrides,
  };
}

export function split(date: string, from: string, to: string): SplitEvent {
  row += 1;
  return {
    kind: "split",
    key: `s${String(row)}`,
    broker: "ibkr",
    source: { file: "test.csv", row },
    date,
    isin: ISIN,
    from: Decimal.parse(from),
    to: Decimal.parse(to),
  };
}
