import { describe, expect, it } from "vitest";

import { ISIN, split, trade } from "../test/events.js";
import type { Decimal } from "./decimal.js";
import { matchFifo } from "./fifo.js";
import type { LedgerEvent } from "./ledger.js";

const history = (events: LedgerEvent[]) => {
  const result = matchFifo(events);
  const apple = result.securities.get(ISIN);
  if (apple === undefined) throw new Error("no history");
  return { ...result, apple };
};

const shares = (values: readonly { readonly quantity: Decimal }[]) =>
  values.map((v) => v.quantity.toString());

describe("matchFifo", () => {
  it("matches across brokers, oldest lot first", () => {
    const t212 = trade("buy", "2024-01-02", "10", "100", {
      broker: "trading212",
    });
    const ibkr = trade("buy", "2024-02-01", "5", "110");
    const { apple, diagnostics } = history([
      trade("sell", "2026-03-01", "12", "150"),
      ibkr,
      t212,
    ]);
    const [disposal] = apple.disposals;
    expect(
      disposal?.matches.map((m) => [m.purchase.broker, m.quantity.toString()]),
    ).toEqual([
      ["trading212", "10"],
      ["ibkr", "2"],
    ]);
    expect(shares(apple.open)).toEqual(["3"]);
    expect(diagnostics).toEqual([]);
  });

  it("restates open lots on a split and keeps their dates", () => {
    const { apple } = history([
      trade("buy", "2019-08-14", "10", "201.72"),
      split("2020-08-31", "1", "4"),
      trade("sell", "2026-03-12", "30"),
    ]);
    const [match] = apple.disposals[0]?.matches ?? [];
    expect(match?.purchase.date).toBe("2019-08-14");
    expect(match?.quantity.toString()).toBe("30");
    expect(match?.factor.toString()).toBe("4");
    expect(shares(apple.open)).toEqual(["10"]);
  });

  it("handles a reverse split", () => {
    const { apple } = history([
      trade("buy", "2023-01-02", "100"),
      split("2024-01-02", "10", "1"),
      trade("sell", "2026-01-05", "10"),
    ]);
    expect(apple.disposals[0]?.matches[0]?.quantity.toString()).toBe("10");
    expect(apple.open).toEqual([]);
  });

  it("treats trades on a split's effective day as post-split, and buys before sells", () => {
    const { apple, diagnostics } = history([
      trade("sell", "2024-06-10", "40"),
      trade("buy", "2024-06-10", "20"),
      split("2024-06-10", "1", "2"),
      trade("buy", "2024-06-01", "10"),
    ]);
    // The 10 bought before the 1:2 split are 20; with 20 bought that day, 40 can go.
    expect(diagnostics).toEqual([]);
    expect(apple.open).toEqual([]);
  });

  it("never guesses a missing purchase", () => {
    const sale = trade("sell", "2026-03-01", "12");
    const { apple, diagnostics } = history([
      trade("buy", "2025-01-02", "10"),
      sale,
    ]);
    expect(apple.disposals[0]?.unmatched.toString()).toBe("2");
    expect(diagnostics).toEqual([
      {
        severity: "blocking",
        code: "insufficientHistory",
        params: { isin: ISIN, date: "2026-03-01", missing: "2" },
        source: sale.source,
      },
    ]);
  });

  it("drops events read twice from overlapping exports, and says so", () => {
    const buy = trade("buy", "2025-01-02", "10");
    const { apple, diagnostics } = history([
      buy,
      trade("sell", "2026-03-01", "10"),
      { ...buy, source: { file: "other.csv", row: 1 } },
    ]);
    expect(apple.purchases).toHaveLength(1);
    expect(apple.open).toEqual([]);
    expect(diagnostics).toEqual([
      { severity: "info", code: "duplicatesRemoved", params: { count: "1" } },
    ]);
  });

  it("refuses a split with a zero side and a trade without quantity", () => {
    const { diagnostics } = history([
      trade("buy", "2025-01-02", "10"),
      split("2025-06-02", "0", "2"),
      trade("buy", "2025-07-02", "0"),
    ]);
    expect(diagnostics.map((x) => x.code)).toEqual([
      "invalidSplit",
      "invalidTrade",
    ]);
  });

  it("keeps the first name and symbol any event carried", () => {
    const { apple } = history([
      trade("buy", "2025-01-02", "1", "1", { security: { isin: ISIN } }),
      trade("buy", "2025-01-03", "1", "1", {
        security: { isin: ISIN, name: "Apple Inc.", isFund: false },
      }),
    ]);
    expect(apple.security).toEqual({ isin: ISIN, name: "Apple Inc." });
  });
});
