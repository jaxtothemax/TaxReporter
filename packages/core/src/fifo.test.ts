// Loads the type-only ledger module, so coverage lists it (added-files-covered).
import "./ledger.js";

import { describe, expect, it } from "vitest";

import { ISIN, split, trade } from "../test/events.js";
import { Decimal } from "./decimal.js";
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
      { severity: "info", code: "duplicatesRemoved", params: { count: 1 } },
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

  it("applies a split once when several brokers report it", () => {
    const events = [
      trade("buy", "2025-01-02", "10"),
      trade("buy", "2025-01-02", "10", "100", {
        broker: "trading212",
        source: { file: "t212.csv", row: 1 },
      }),
      split("2025-06-10", "1", "4"),
      split("2025-06-12", "2", "8", "trading212"),
    ];
    const { apple, diagnostics } = history(events);
    expect(apple.splits).toHaveLength(1);
    expect(shares(apple.open)).toEqual(["40", "40"]);
    expect(diagnostics).toEqual([
      {
        severity: "info",
        code: "splitReportsMerged",
        params: { isin: ISIN, date: "2025-06-10" },
      },
    ]);
  });

  it("blocks split reports that disagree, or that a trade falls between", () => {
    const conflict = history([
      trade("buy", "2025-01-02", "10"),
      split("2025-06-10", "1", "4"),
      split("2025-06-10", "1", "2", "trading212"),
    ]);
    expect(conflict.diagnostics.map((d) => d.code)).toEqual(["splitConflict"]);
    expect(conflict.apple.splits).toHaveLength(1);

    // Bought at Trading 212 on the 11th: in old shares there, in new ones
    // by the IBKR date.
    const between = history([
      trade("buy", "2025-01-02", "10"),
      split("2025-06-10", "1", "4"),
      trade("buy", "2025-06-11", "5", "50", {
        broker: "trading212",
        source: { file: "t212.csv", row: 2 },
      }),
      split("2025-06-12", "1", "4", "trading212"),
    ]);
    expect(between.diagnostics).toEqual([
      expect.objectContaining({
        severity: "blocking",
        code: "splitDateAmbiguous",
        params: { isin: ISIN, date: "2025-06-10", until: "2025-06-12" },
      }),
    ]);
  });

  it("keeps two splits one broker reports, and caps how many there can be", () => {
    const twice = history([
      trade("buy", "2025-01-02", "10"),
      split("2025-06-10", "1", "2"),
      split("2025-06-12", "1", "2"),
    ]);
    expect(shares(twice.apple.open)).toEqual(["40"]);
    const many = history([
      trade("buy", "2000-01-03", "1"),
      ...Array.from({ length: 33 }, (_, i) =>
        split(`${String(2001 + i)}-01-03`, "1", "1"),
      ),
    ]);
    expect(many.diagnostics.map((d) => d.code)).toEqual(["tooManySplits"]);
    expect(many.apple.splits).toHaveLength(32);
  });

  it("refuses events it cannot trust, without repeating what they say", () => {
    const bad = (overrides: Record<string, unknown>) =>
      ({ ...trade("buy", "2025-01-02", "1"), ...overrides }) as never;
    const { diagnostics } = matchFifo([
      bad({ date: "2025-1-2" }),
      bad({ security: { isin: "us0378331005" } }),
      bad({ side: "BUY" }),
      bad({ price: { amount: Decimal.parse("-1"), currency: "USD" } }),
      bad({ price: { amount: Decimal.parse("1"), currency: "U1234567" } }),
      { ...trade("buy", "2025-01-02", "1"), kind: "spinoff" } as never,
      { ...split("2025-06-10", "2", "3"), to: Decimal.parse("1.5") },
      { ...split("2025-06-10", "1", "2"), to: Decimal.fromInteger(100_000) },
    ]);
    // Listed by file and row (ibkr.csv before test.csv), not as loaded.
    expect(diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["invalidSplit", { isin: ISIN, date: "2025-06-10" }],
      ["invalidSplit", { isin: ISIN, date: "2025-06-10" }],
      ["invalidTrade", { isin: ISIN }],
      ["invalidTrade", { date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["unknownEvent", {}],
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("U1234567");
  });

  it("refuses a key repeated in one file, or reported twice with other content", () => {
    const buy = trade("buy", "2025-01-02", "10");
    const inFile = matchFifo([
      buy,
      { ...buy, source: { ...buy.source, row: 99 } },
    ]);
    expect(inFile.diagnostics.map((d) => d.code)).toEqual([
      "duplicateKeyInFile",
    ]);
    const changed = matchFifo([
      buy,
      {
        ...buy,
        quantity: Decimal.parse("20"),
        source: { file: "b.csv", row: 1 },
      },
    ]);
    expect(changed.diagnostics.map((d) => d.code)).toEqual([
      "duplicateKeyConflict",
    ]);
    // The same key from another broker is another trade.
    const other = matchFifo([buy, { ...buy, broker: "trading212" }]);
    expect(other.diagnostics).toEqual([]);
    expect(other.securities.get(ISIN)?.purchases).toHaveLength(2);
  });

  it("keeps the report read first by file and row, whatever the order", () => {
    const a = trade("buy", "2025-01-02", "10", "100", {
      key: "same",
      security: { isin: ISIN, name: "Apple Inc" },
      source: { file: "a.csv", row: 5 },
    });
    const b = {
      ...a,
      security: { isin: ISIN, name: "APPLE INC." },
      source: { file: "b.csv", row: 2 },
    };
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const { apple } = history(order);
      expect(apple.security.name).toBe("Apple Inc");
      expect(apple.purchases[0]?.source.file).toBe("a.csv");
    }
  });

  it("blocks a key repeated inside any one file, not only the first", () => {
    const a = trade("buy", "2025-01-02", "10", "100", {
      key: "k",
      source: { file: "a.csv", row: 1 },
    });
    const b1 = { ...a, source: { file: "b.csv", row: 1 } };
    const b2 = { ...a, source: { file: "b.csv", row: 2 } };
    const { diagnostics } = matchFifo([a, b1, b2]);
    expect(diagnostics.map((d) => [d.code, d.source])).toEqual([
      ["duplicatesRemoved", undefined],
      ["duplicateKeyInFile", { file: "b.csv", row: 2 }],
    ]);
  });

  it("gives the same result whatever order the events come in", () => {
    const events = [
      trade("buy", "2025-02-03", "10", "100", { security: { isin: ISIN } }),
      trade("buy", "2025-02-03", "10", "130", {
        broker: "trading212",
        source: { file: "t212.csv", row: 1 },
        security: { isin: ISIN, symbol: "AAPL", name: "Apple Inc." },
      }),
      trade("sell", "2026-05-04", "15"),
      split("2025-06-10", "1", "2"),
    ];
    const summary = (input: LedgerEvent[]) => {
      const { apple } = history(input);
      return JSON.stringify([
        apple.security,
        apple.disposals.map((d) =>
          d.matches.map((m) => [m.purchase.broker, m.quantity.toString()]),
        ),
      ]);
    };
    const expected = summary(events);
    for (const order of [
      [3, 2, 1, 0],
      [1, 0, 3, 2],
      [2, 3, 0, 1],
    ]) {
      expect(summary(order.map((i) => events[i] as LedgerEvent))).toBe(
        expected,
      );
    }
  });

  it("warns when the order of one day's lots at two brokers decided a sale", () => {
    const { diagnostics } = history([
      trade("buy", "2025-02-03", "10", "100"),
      trade("buy", "2025-02-03", "10", "130", {
        broker: "trading212",
        source: { file: "t212.csv", row: 1 },
      }),
      trade("sell", "2026-05-04", "15"),
    ]);
    expect(diagnostics.map((d) => [d.code, d.params])).toEqual([
      [
        "sameDayLotOrder",
        { isin: ISIN, date: "2026-05-04", purchased: "2025-02-03" },
      ],
    ]);
  });

  it("warns of a purchase at no cost, which may be income", () => {
    const { diagnostics } = history([trade("buy", "2025-02-03", "1", "0")]);
    expect(diagnostics.map((d) => d.code)).toEqual(["zeroCostPurchase"]);
  });

  it("stays linear in the number of lots and sales", () => {
    const events: LedgerEvent[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      events.push(trade("buy", "2025-01-02", "1"));
    }
    for (let i = 0; i < 10_000; i += 1) {
      events.push(trade("sell", "2026-01-05", "1"));
    }
    const started = Date.now();
    const { apple } = history(events);
    expect(apple.open).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
