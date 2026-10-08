// Loads the type-only ledger module, so coverage lists it (added-files-covered).
import "./ledger.js";

import { describe, expect, it } from "vitest";

import { account, ISIN, split, trade, validated } from "../test/events.js";
import { Decimal } from "./decimal.js";
import { matchFifo } from "./fifo.js";
import type { LedgerEvent } from "./ledger.js";

const history = (events: LedgerEvent[]) => {
  const result = matchFifo(validated(events));
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
      trade("buy", "2025-01-02", "10", "100", { broker: "trading212" }),
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
      trade("buy", "2025-06-11", "5", "50", { broker: "trading212" }),
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

  it("gives the same result whatever order the events come in", () => {
    const events = [
      trade("buy", "2025-02-03", "10", "100", { security: { isin: ISIN } }),
      trade("buy", "2025-02-03", "10", "130", {
        broker: "trading212",
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

  it("warns when the order of one day's untimed lots decided a sale", () => {
    const { diagnostics } = history([
      trade("buy", "2025-02-03", "10", "100"),
      trade("buy", "2025-02-03", "10", "130", { broker: "trading212" }),
      trade("sell", "2026-05-04", "15"),
    ]);
    expect(diagnostics.map((d) => [d.code, d.params])).toEqual([
      [
        "sameDayLotOrder",
        { isin: ISIN, date: "2026-05-04", purchased: "2025-02-03" },
      ],
    ]);
  });

  it("warns as well when one broker's untimed lots of a day decided a sale", () => {
    const { diagnostics } = history([
      trade("buy", "2025-02-03", "10", "100"),
      trade("buy", "2025-02-03", "10", "130"),
      trade("sell", "2026-05-04", "15"),
    ]);
    expect(diagnostics.map((d) => d.code)).toEqual(["sameDayLotOrder"]);
    // At one price, the order cannot change the cost: nothing to say.
    const same = history([
      trade("buy", "2025-02-03", "10", "100"),
      trade("buy", "2025-02-03", "10", "100"),
      trade("sell", "2026-05-04", "15"),
    ]);
    expect(same.diagnostics).toEqual([]);
  });

  it("takes one day's lots in the order the brokers' clocks give", () => {
    const at = (instant: string) => ({ instant, brokerDate: null });
    const late = trade("buy", "2025-02-03", "10", "130", {
      broker: "trading212",
      at: at("2025-02-03T15:30:00Z"),
    });
    const early = trade("buy", "2025-02-03", "10", "100", {
      broker: "trading212",
      at: at("2025-02-03T09:00:00Z"),
    });
    // Another broker's lot an hour later still comes between them.
    const ibkr = trade("buy", "2025-02-03", "1", "120", {
      at: at("2025-02-03T10:00:00Z"),
    });
    const { apple, diagnostics } = history([
      late,
      ibkr,
      early,
      trade("sell", "2026-05-04", "15"),
    ]);
    expect(apple.disposals[0]?.matches.map((m) => m.purchase)).toEqual([
      early,
      ibkr,
      late,
    ]);
    expect(diagnostics).toEqual([]);

    // Two prices at one instant leave the order open again.
    const tied = history([
      trade("buy", "2025-02-03", "10", "100", {
        at: at("2025-02-03T09:00:00Z"),
      }),
      trade("buy", "2025-02-03", "10", "130", {
        at: at("2025-02-03T09:00:00Z"),
      }),
      trade("sell", "2026-05-04", "15"),
    ]);
    expect(tied.diagnostics.map((d) => d.code)).toEqual(["sameDayLotOrder"]);
  });

  it("lets a trade in the account that reported a split first stand", () => {
    // Account 2 books the split two days after account 1. Account 1's own
    // trade in between is in its new shares; nothing is ambiguous.
    const { apple, diagnostics } = history([
      trade("buy", "2025-01-02", "10"),
      trade("buy", "2025-01-02", "10", "100", { account: account("ibkr", 2) }),
      split("2025-06-10", "1", "4"),
      trade("buy", "2025-06-11", "4", "25"),
      split("2025-06-12", "1", "4", "ibkr", 2),
    ]);
    expect(diagnostics.map((d) => d.code)).toEqual(["splitReportsMerged"]);
    expect(shares(apple.open)).toEqual(["40", "40", "4"]);
  });

  it("checks a split reported as a share change against the broker's shares", () => {
    const at = (positionChange: string) => ({
      ...split("2025-06-10", "1", "4"),
      positionChange: Decimal.parse(positionChange),
    });
    const held = [trade("buy", "2025-01-02", "10")];
    // 10 shares, 4 for 1: 30 more.
    expect(history([...held, at("30")]).diagnostics).toEqual([]);
    const off = history([...held, at("20")]);
    expect(off.diagnostics.map((d) => [d.code, d.params])).toEqual([
      [
        "splitPositionMismatch",
        { isin: ISIN, date: "2025-06-10", expected: "30", reported: "20" },
      ],
    ]);
    // A broker holding none of it cannot report a split of it.
    const elsewhere = history([
      trade("buy", "2025-01-02", "10", "100", { broker: "trading212" }),
      at("30"),
    ]);
    expect(elsewhere.diagnostics.map((d) => d.code)).toEqual([
      "splitPositionMismatch",
    ]);
  });

  it("applies a split once when two accounts at one broker report it", () => {
    const { apple, diagnostics } = history([
      trade("buy", "2025-01-02", "10"),
      trade("buy", "2025-01-02", "10", "100", {
        account: account("ibkr", 2),
      }),
      split("2025-06-10", "1", "4"),
      split("2025-06-10", "1", "4", "ibkr", 2),
    ]);
    expect(apple.splits).toHaveLength(1);
    expect(shares(apple.open)).toEqual(["40", "40"]);
    expect(diagnostics.map((d) => d.code)).toEqual(["splitReportsMerged"]);
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
