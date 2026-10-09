/**
 * The Trade Republic adapter against its synthetic export
 * (test/fixtures/trade-republic/README.md), and against the rows it must
 * refuse.
 */
import { readFileSync } from "node:fs";

import {
  fileIdOf,
  forExport,
  matchFifo,
  validateLedger,
  type LedgerEvent,
  type TradeEvent,
} from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { importFile, type ImportResult } from "./adapter.js";
import { TRADE_REPUBLIC_COLUMNS } from "./trade-republic.js";

const fixture = readFileSync(
  new URL(
    "../test/fixtures/trade-republic/tr-transactions-2026.csv",
    import.meta.url,
  ),
  "utf8",
);

/** An export's text, imported as its bytes. */
function read(text: string): ImportResult {
  const bytes = new TextEncoder().encode(text);
  return importFile({ bytes, fileId: fileIdOf(bytes), accountGroup: 1 });
}

const HEADER = TRADE_REPUBLIC_COLUMNS.map((c) => `"${c}"`).join(",");

type Cells = Partial<Record<(typeof TRADE_REPUBLIC_COLUMNS)[number], string>>;

/** One row, a purchase of Apple unless told otherwise. */
function row(cells: Cells = {}): string {
  const all: Cells = {
    datetime: "2026-03-10T14:05:12.000Z",
    date: "2026-03-10",
    account_type: "DEFAULT",
    category: "TRADING",
    type: "BUY",
    asset_class: "STOCK",
    name: "Apple",
    symbol: "US0378331005",
    shares: "2.0000000000",
    price: "180.500000",
    amount: "-361.00",
    fee: "-1.00",
    currency: "EUR",
    transaction_id: "00000000-0000-4000-8000-000000000099",
    ...cells,
  };
  return TRADE_REPUBLIC_COLUMNS.map((c) => `"${all[c] ?? ""}"`).join(",");
}

const rows = (...lines: string[]) => read([HEADER, ...lines].join("\n"));

const codes = (result: ImportResult) => result.diagnostics.map((d) => d.code);

describe("tradeRepublic: the export", () => {
  const result = read(fixture);

  it("is recognized by its 23 columns", () => {
    expect([result.broker, result.format]).toEqual([
      "traderepublic",
      "traderepublic-csv-2026",
    ]);
    // One column more is another revision, not read on a guess.
    const wider = `${HEADER},"extra"\n${row()},""`;
    expect(codes(read(wider))).toEqual(["unknownFormat"]);
  });

  it("reads purchases, savings plans and sales at their price, on their Ljubljana date", () => {
    const trades = result.events.filter(
      (e): e is TradeEvent => e.kind === "trade",
    );
    expect(
      trades.map((t) => [
        t.side,
        t.date,
        t.security.isin,
        t.quantity.toString(),
        t.price.amount.toString(),
        t.price.currency,
        t.security.isFund === true,
      ]),
    ).toEqual([
      [
        "buy",
        "2026-01-02",
        "IE00B4L5Y983",
        "1.2345678901",
        "101.23",
        "EUR",
        true,
      ],
      ["buy", "2026-02-02", "IE00B4L5Y983", "1.2", "104.1", "EUR", true],
      ["buy", "2026-03-10", "US0378331005", "2", "180.5", "EUR", false],
      // 22:40 UTC on 14 July: 15 July in Ljubljana, as Trade Republic says.
      ["sell", "2026-07-15", "US0378331005", "1", "210", "EUR", false],
      ["buy", "2026-08-03", "IE00B4L5Y983", "1.15", "108.6", "EUR", true],
    ]);
    expect(trades[3]?.at).toEqual({
      instant: "2026-07-14T22:40:55Z",
      brokerDate: "2026-07-15",
    });
  });

  it("ignores cash rows by reason, and warns that interest is not covered", () => {
    const ignored = result.events.filter((e) => e.kind === "ignored");
    expect(ignored.map((e) => [e.source.row, e.reason])).toEqual([
      [2, "deposit"],
      [6, "cardSpending"],
      [7, "interest"],
    ]);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "interestNotCovered",
        params: { broker: "traderepublic", count: 1 },
      },
    ]);
  });

  it("accounts for every row: an event, an ignored row or a finding", () => {
    const lines = fixture.trim().split("\n").length - 1;
    const rowsSeen = new Set(result.events.map((e) => e.source.row));
    expect(rowsSeen.size).toBe(lines);
    expect(result.reach).toHaveLength(1);
    expect(result.reach[0]?.lastDate).toBe("2026-08-03");
  });

  it("gives a ledger the engine takes, and matches the sale first in, first out", () => {
    const ledger = validateLedger(result.events);
    expect(ledger.diagnostics).toEqual([]);
    const fifo = matchFifo(ledger);
    expect(fifo.diagnostics).toEqual([]);
  });
});

describe("tradeRepublic: what it refuses", () => {
  it("refuses dividends until a real export confirms their columns", () => {
    const result = rows(
      row({
        category: "CASH",
        type: "DIVIDEND",
        shares: "0.2702700000",
        price: "",
        amount: "0.060000",
        tax: "-0.01",
        original_amount: "0.07",
        original_currency: "USD",
        fx_rate: "1.160000",
      }),
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "blocking",
        code: "unconfirmedAction",
        params: { broker: "traderepublic", action: "DIVIDEND" },
      }),
    ]);
    expect(result.events).toEqual([]);
  });

  it("refuses free shares, corporate actions, migrations and other assets", () => {
    for (const [cells, action] of [
      [{ type: "BENEFITS_SAVEBACK" }, "BENEFITS_SAVEBACK"],
      [{ type: "STOCKPERK" }, "STOCKPERK"],
      [{ type: "BONUS" }, "BONUS"],
      [{ type: "MIGRATION" }, "MIGRATION"],
      [{ category: "CORPORATE_ACTION", type: "SPLIT" }, "CORPORATE_ACTION"],
      [{ category: "DELIVERY", type: "BUY" }, "DELIVERY"],
      [{ asset_class: "BOND" }, "BOND"],
      [{ asset_class: "CRYPTO" }, "CRYPTO"],
      [{ asset_class: "SOMETHING" }, "other asset"],
    ] as const) {
      const [d] = rows(row(cells)).diagnostics;
      expect([d?.severity, d?.code, d?.params], action).toEqual([
        "blocking",
        "unsupportedAction",
        { broker: "traderepublic", action },
      ]);
    }
  });

  it("refuses a type or an account it does not know, keeping their text out of exports", () => {
    for (const cells of [
      { type: "SECRET_TYPE" },
      { account_type: "SECRET_ACCOUNT" },
      { category: "CASH", type: "BUY" },
    ]) {
      const [d] = rows(row(cells)).diagnostics;
      expect(d?.code).toBe("unknownAction");
      if (d === undefined) throw new Error("no finding");
      expect(JSON.stringify(forExport(d))).not.toContain("SECRET");
    }
  });

  it("refuses a row it cannot date, or whose date and time disagree", () => {
    expect(codes(rows(row({ datetime: "10.03.2026 14:05" })))).toEqual([
      "invalidTime",
    ]);
    expect(codes(rows(row({ date: "2026-02-30" })))).toEqual(["invalidTime"]);
    // 14:05 UTC is 15:05 in Berlin, the same day; the 11th is another.
    expect(codes(rows(row({ date: "2026-03-11" })))).toEqual(["invalidTime"]);
  });

  it("refuses a sign, a number, a price, an ISIN or a currency that is wrong", () => {
    const cases: [Cells, string][] = [
      [{ shares: "-2.0000000000" }, "unexpectedSign"],
      [{ type: "SELL", shares: "2.0000000000" }, "unexpectedSign"],
      [{ shares: "0.0000000000" }, "unexpectedSign"],
      [{ shares: "2,5" }, "invalidNumber"],
      [{ shares: "1e3" }, "invalidNumber"],
      [{ price: "" }, "invalidNumber"],
      [{ price: "0.000000" }, "invalidPrice"],
      [{ symbol: "AAPL" }, "invalidIsin"],
      [{ currency: "eur" }, "invalidCurrency"],
    ];
    for (const [cells, code] of cases) {
      expect(codes(rows(row(cells))), JSON.stringify(cells)).toEqual([code]);
    }
  });
});

describe("tradeRepublic: overlapping exports", () => {
  it("are one account, so the second copy of each trade is dropped", () => {
    const first = read(fixture);
    const second = read(`${fixture}\n`);
    expect(second.events[0]?.source.fileId).not.toBe(
      first.events[0]?.source.fileId,
    );
    expect(second.events[0]?.account).toBe(first.events[0]?.account);
    const all: LedgerEvent[] = [...first.events, ...second.events];
    const keyed = first.events.filter((e) => e.kind !== "ignored").length;
    const ledger = validateLedger(all);
    expect(ledger.diagnostics).toEqual([
      {
        severity: "info",
        code: "duplicatesRemoved",
        params: { count: keyed },
      },
    ]);
  });

  it("names the account whatever group the file was put in", () => {
    const bytes = new TextEncoder().encode(fixture);
    const groups = [1, 2].map(
      (accountGroup) =>
        importFile({ bytes, fileId: fileIdOf(bytes), accountGroup }).events[0]
          ?.account,
    );
    expect(groups[0]).toBe(groups[1]);
    expect(groups[0]).toMatch(/^traderepublic:[0-9a-f]+$/);
  });
});
