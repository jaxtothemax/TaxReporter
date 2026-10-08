/**
 * The Trading 212 adapter against one synthetic export per header revision
 * (test/fixtures/trading212/README.md), and against the rows it must refuse.
 */
import { readFileSync } from "node:fs";

import {
  deduplicate,
  type LedgerEvent,
  type TradeEvent,
} from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { importFile, type ImportResult } from "./adapter.js";
import { splitRatio } from "./trading212.js";

const fixture = (file: string) =>
  readFileSync(
    new URL(`../test/fixtures/trading212/${file}`, import.meta.url),
    "utf8",
  );

const imported = (file: string) => importFile(file, fixture(file));

const V4_HEADER =
  "Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax)";

/** A V4 export of the given rows (17 columns each). */
const v4 = (...rows: string[]) =>
  importFile("t.csv", [V4_HEADER, ...rows].join("\n"));

/**
 * The rows an import accounts for: events, ignored records and blocking
 * diagnostics. A warning or a note accounts for nothing.
 */
function accountedRows(result: ImportResult): number[] {
  const rows = new Set<number>();
  for (const event of result.events) rows.add(event.source.row);
  for (const d of result.diagnostics) {
    if (d.source !== undefined && d.severity === "blocking") {
      rows.add(d.source.row);
    }
  }
  return [...rows].sort((a, b) => a - b);
}

const kinds = (result: ImportResult) =>
  result.events.map((e) =>
    e.kind === "ignored" ? `ignored:${e.reason}` : e.kind,
  );

const blocking = (result: ImportResult) =>
  result.diagnostics
    .filter((d) => d.severity === "blocking")
    .map((d) => [d.code, d.source?.row]);

describe("every header revision", () => {
  it.each([
    ["t212-invest-v1-2022.csv", "trading212-csv-v1", 3],
    ["t212-invest-v2-2024.csv", "trading212-csv-v2", 4],
    ["t212-invest-v3-2025.csv", "trading212-csv-v3", 5],
    ["t212-invest-v4-2026.csv", "trading212-csv-v4", 10],
  ])("%s: recognized as %s, every row accounted for", (file, format, rows) => {
    const result = imported(file);
    expect(result.format).toBe(format);
    expect(blocking(result)).toEqual([]);
    // Data rows are numbered from 2: the header is row 1.
    expect(accountedRows(result)).toEqual(
      Array.from({ length: rows }, (_, i) => i + 2),
    );
  });
});

describe("the 2026 export (V4)", () => {
  const result = imported("t212-invest-v4-2026.csv");
  const trades = result.events.filter(
    (e): e is TradeEvent => e.kind === "trade",
  );

  it("turns each row into its event", () => {
    expect(kinds(result)).toEqual([
      "ignored:deposit",
      "trade",
      "trade",
      "dividend",
      "withholding",
      "trade",
      "ignored:interest",
      "trade",
      "trade",
      "split",
      "ignored:pairedRow",
    ]);
    expect(result.lastDate).toBe("2026-09-10");
  });

  it("reads trades at the contract price in the instrument's currency", () => {
    expect(
      trades.map((t) => [
        t.side,
        t.date,
        t.security.isin,
        t.quantity.toString(),
        t.price.amount.toString(),
        t.price.currency,
      ]),
    ).toEqual([
      ["buy", "2026-01-06", "US1912161007", "20", "69.5", "USD"],
      ["buy", "2026-01-07", "FR0000121014", "0.5", "600", "EUR"],
      ["sell", "2026-05-15", "US1912161007", "8", "72.1", "USD"],
      ["sell", "2026-06-18", "IE00BK5BQT80", "1.2345678912", "141.92", "EUR"],
      ["sell", "2026-09-10", "US00000ACME1", "9", "100", "USD"],
    ]);
    // Fees and T212's own rates and results are never carried over.
    expect(trades.every((t) => t.commission === undefined)).toBe(true);
  });

  it("makes the dividend gross: net per share times shares, plus the tax", () => {
    const dividend = result.events.find((e) => e.kind === "dividend");
    const tax = result.events.find((e) => e.kind === "withholding");
    if (dividend?.kind !== "dividend" || tax?.kind !== "withholding") {
      throw new Error("no dividend");
    }
    // 20 x 0.4335 = 8.67 net, + 1.53 withheld.
    expect([
      dividend.date,
      dividend.gross.amount.toString(),
      dividend.gross.currency,
    ]).toEqual(["2026-04-01", "10.2", "USD"]);
    expect([tax.dividendKey, tax.amount.amount.toString(), tax.isin]).toEqual([
      dividend.key,
      "1.53",
      "US1912161007",
    ]);
  });

  it("reads a split pair as one split", () => {
    const split = result.events.find((e) => e.kind === "split");
    expect(split).toMatchObject({
      date: "2026-03-02",
      isin: "US00000ACME1",
    });
    if (split?.kind !== "split") throw new Error("no split");
    expect([split.from.toString(), split.to.toString()]).toEqual(["1", "3"]);
  });

  it("says interest is taxable on a return this version does not build", () => {
    expect(result.diagnostics.filter((d) => d.severity === "warning")).toEqual([
      {
        severity: "warning",
        code: "interestNotCovered",
        params: { broker: "trading212", count: "1" },
      },
    ]);
  });

  it("marks a fund by its name, and says so once", () => {
    const vwce = trades.find((t) => t.security.isin === "IE00BK5BQT80");
    expect(vwce?.security.isFund).toBe(true);
    expect(
      trades.find((t) => t.security.isin === "US1912161007")?.security,
    ).toEqual({ isin: "US1912161007", symbol: "KO", name: "Coca-Cola" });
    expect(result.diagnostics.filter((d) => d.code === "fundFromName")).toEqual(
      [
        {
          severity: "info",
          code: "fundFromName",
          params: { isin: "IE00BK5BQT80" },
        },
      ],
    );
  });
});

describe("earlier revisions", () => {
  it("V1: pence prices, and currencies in the header names", () => {
    const result = imported("t212-invest-v1-2022.csv");
    const [buy] = result.events.filter((e) => e.kind === "trade");
    expect(buy).toMatchObject({
      date: "2022-03-02",
      price: { currency: "GBX" },
    });
  });

  it('V2: a dividend whose exchange rate is "Not available"', () => {
    const result = imported("t212-invest-v2-2024.csv");
    const dividend = result.events.find((e) => e.kind === "dividend");
    if (dividend?.kind !== "dividend") throw new Error("no dividend");
    // 1 x 0.6375 net + 0.11 withheld.
    expect(dividend.gross.amount.toString()).toBe("0.7475");
  });

  it("V3: fractional shares to 10 decimals, and cash rows set aside", () => {
    const result = imported("t212-invest-v3-2025.csv");
    expect(kinds(result)).toEqual([
      "ignored:deposit",
      "trade",
      "trade",
      "ignored:currencyConversion",
      "ignored:other",
    ]);
  });
});

describe("rows it refuses rather than guesses", () => {
  const BUY =
    "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,USD,1.17,,,118.55,EUR,,";

  it("an action it does not know, and one whose tax treatment is unsettled", () => {
    const result = v4(
      "Gift card,2026-01-06 14:31:02+00:00,,,,,,,,,,,,5,EUR,,",
      "Transfer in,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,,2,69.5,USD,,,,,,,",
      "Dividend (Dividend manufactured payment),2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,,2,0.5,USD,,,,1,EUR,,",
    );
    // The action is the file's text: the row says which, the finding not.
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["unknownAction", { broker: "trading212" }],
      ["unsupportedAction", { broker: "trading212", action: "Transfer in" }],
      [
        "unsupportedAction",
        {
          broker: "trading212",
          action: "Dividend (Dividend manufactured payment)",
        },
      ],
    ]);
    expect(result.events).toEqual([]);
  });

  it("a column it does not know, once any row fills it", () => {
    const header = `${V4_HEADER},Bonus`;
    const empty = importFile("t.csv", `${header}\n${BUY},`);
    expect(empty.diagnostics).toEqual([]);
    const filled = importFile("t.csv", `${header}\n${BUY},1`);
    // The column by its position: a header name is the file's text.
    expect(filled.diagnostics).toEqual([
      {
        severity: "blocking",
        code: "unknownColumn",
        params: { broker: "trading212", position: "18" },
      },
    ]);
  });

  it("numbers, ISINs, times and prices that are not what they claim", () => {
    const result = v4(
      'Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,"1,000",69.5,USD,,,,1,EUR,,',
      "Market buy,2026-01-06 14:31:02+00:00,US1912161006,KO,Coca-Cola,,EOF1,2,69.5,USD,,,,1,EUR,,",
      "Market buy,06/01/2026 14:31,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,USD,,,,1,EUR,,",
      "Market sell,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0,USD,,,,0,EUR,,",
      "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,0,69.5,USD,,,,1,EUR,,",
      "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,1e2,USD,,,,1,EUR,,",
    );
    expect(blocking(result)).toEqual([
      ["invalidNumber", 2],
      ["invalidIsin", 3],
      ["invalidTime", 4],
      ["invalidPrice", 5],
      ["invalidQuantity", 6],
      ["invalidNumber", 7],
    ]);
    // The column is named, the value never.
    expect(result.diagnostics[0]?.params).toEqual({ column: "No. of shares" });
  });

  it("dividend tax in another currency, or with a sign", () => {
    const result = v4(
      "Dividend (Dividend),2026-04-01 12:10:44+00:00,US1912161007,KO,Coca-Cola,,,20,0.4335,USD,,,,7.41,EUR,1.31,EUR",
      "Dividend (Dividend),2026-04-01 12:10:44+00:00,US1912161007,KO,Coca-Cola,,,20,0.4335,USD,,,,7.41,EUR,-1.53,USD",
    );
    expect(blocking(result)).toEqual([
      ["dividendTaxCurrency", 2],
      ["unexpectedSign", 3],
    ]);
  });

  it("split halves that do not pair, disagree, or fit no ratio", () => {
    const half = (
      action: string,
      time: string,
      shares: string,
      total: string,
    ) =>
      `${action},${time},US00000ACME1,ACME,Acme Corp,,,${shares},100,USD,,,,${total},EUR,,`;
    const result = v4(
      half("Stock split close", "2026-03-02 07:00:00", "3", "775.86"),
      half("Stock split close", "2026-04-02 07:00:00", "3", "775.86"),
      half("Stock split open", "2026-04-02 07:00:00", "9", "700.00"),
      half("Stock split close", "2026-05-04 07:00:00", "3", "775.86"),
      half("Stock split open", "2026-05-04 07:00:00", "7.1234", "775.86"),
    );
    // Each row of a refused pair is accounted for by the refusal.
    expect(blocking(result)).toEqual([
      ["splitUnpaired", 2],
      ["splitHalvesDisagree", 3],
      ["splitHalvesDisagree", 4],
      ["splitRatioUnclear", 5],
      ["splitRatioUnclear", 6],
    ]);
    expect(accountedRows(result)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("limits and shapes", () => {
  it("refuses a currency not written as T212 writes it", () => {
    const result = v4(
      "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,usd,,,,118.55,EUR,,",
      "Market buy,2026-01-06 14:31:02+00:00,GB00B10RZP78,ULVR,Unilever,,EOF2,2,3500,GBX,,,,80,EUR,,",
    );
    expect(blocking(result)).toEqual([["invalidCurrency", 2]]);
  });

  it("refuses more split pairs on one security than any history has", () => {
    const rows = Array.from({ length: 33 }, (_, i) => {
      const time = `2026-0${String(1 + Math.floor(i / 28))}-${String(1 + (i % 28)).padStart(2, "0")} 07:00:00`;
      return [
        `Stock split close,${time},US00000ACME1,ACME,Acme Corp,,,1,100,USD,,,,10,EUR,,`,
        `Stock split open,${time},US00000ACME1,ACME,Acme Corp,,,2,50,USD,,,,10,EUR,,`,
      ];
    }).flat();
    const result = v4(...rows);
    expect(new Set(blocking(result).map(([code]) => code))).toEqual(
      new Set(["tooManySplits"]),
    );
    expect(result.events.filter((e) => e.kind === "split")).toEqual([]);
  });

  it("caps the findings of one file, and keeps the cap blocking", () => {
    const bad = Array.from(
      { length: 1200 },
      () => "Gift card,2026-01-06 14:31:02+00:00,,,,,,,,,,,,5,EUR,,",
    );
    const result = v4(...bad);
    expect(result.diagnostics).toHaveLength(1001);
    expect(result.diagnostics.at(-1)).toEqual({
      severity: "blocking",
      code: "diagnosticsTruncated",
      params: { dropped: "200" },
    });
  });

  it("keeps keys apart even when an ID holds a separator", () => {
    const row = (id: string, qty: string) =>
      `Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,${id},${qty},69.5,USD,,,,1,EUR,,`;
    const result = v4(row('"A|2"', "1"), row("A", "2|1"));
    const keys = result.events.map((e) => (e.kind === "ignored" ? "" : e.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("takes a file as a CFD export only beside T212's own columns", () => {
    expect(
      importFile("x.csv", "RecordType,Date,Amount\nX,2026-01-01,5\n")
        .diagnostics,
    ).toEqual([{ severity: "blocking", code: "unknownFormat", params: {} }]);
  });
});

describe("splitRatio", () => {
  const ratio = (before: string, after: string) => {
    const r = splitRatio(before, after);
    return r === null ? null : `${r.to.toString()}:${r.from.toString()}`;
  };

  it("finds the whole-number ratio, forward or reverse", () => {
    expect(ratio("3", "9")).toBe("3:1");
    expect(ratio("2", "3")).toBe("3:2");
    expect(ratio("10", "1")).toBe("1:10");
    expect(ratio("0.5", "5")).toBe("10:1");
  });

  it("allows for T212 writing positions to 10 decimals", () => {
    // 0.1234567891 / 10 = 0.01234567891, written as 0.0123456789.
    expect(ratio("0.1234567891", "0.0123456789")).toBe("1:10");
  });

  it("refuses what no plausible split explains", () => {
    expect(ratio("3", "7.1234")).toBeNull();
    expect(ratio("1", "100000")).toBeNull();
    expect(ratio("0", "1")).toBeNull();
  });

  it("works it out in a few steps, whatever the input", () => {
    const started = Date.now();
    for (let i = 0; i < 2000; i += 1) {
      ratio("999999999999999.999999999999", "0.000000000001");
      ratio("0.1234567891", "0.0123456789");
      ratio("3", "7.1234");
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("overlapping exports", () => {
  it("give the same keys, so the second copy of each event is dropped", () => {
    const first = imported("t212-invest-v4-2026.csv");
    const second = importFile("again.csv", fixture("t212-invest-v4-2026.csv"));
    const all: LedgerEvent[] = [...first.events, ...second.events];
    const { events, diagnostics } = deduplicate(all);
    const keyed = first.events.filter((e) => e.kind !== "ignored").length;
    expect(diagnostics).toEqual([
      {
        severity: "info",
        code: "duplicatesRemoved",
        params: { count: String(keyed) },
      },
    ]);
    expect(events.length).toBe(all.length - keyed);
  });

  it("keep two identical rows of one file apart: they are two fills", () => {
    const row =
      "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,USD,,,,118.55,EUR,,";
    const result = v4(row, row);
    const keys = result.events.map((e) => (e.kind === "ignored" ? "" : e.key));
    expect(new Set(keys).size).toBe(2);
    expect(deduplicate(result.events).diagnostics).toEqual([]);
  });
});

describe("importFile", () => {
  it("refuses a CFD account's export by name", () => {
    const result = importFile(
      "cfd.csv",
      "RecordType,Time,Ticker,Quantity\nCLOSED_POSITION,2026-01-06 14:31:02,KO,2\n",
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "derivativesNotSupported",
    ]);
  });

  it("refuses a file no adapter knows, or that is not CSV at all", () => {
    expect(
      importFile("x.csv", "Date,Amount\n2026-01-01,5\n").diagnostics,
    ).toEqual([{ severity: "blocking", code: "unknownFormat", params: {} }]);
    expect(importFile("x.csv", 'A,B\n"open\n').diagnostics).toEqual([
      {
        severity: "blocking",
        code: "unreadableFile",
        params: { reason: "unterminatedQuote", row: "2" },
      },
    ]);
  });

  it("moves a late-evening UTC trade to the next day in Ljubljana, and says so", () => {
    const result = v4(
      "Market buy,2026-07-15 22:30:00+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,USD,,,,118.55,EUR,,",
    );
    expect(result.events[0]).toMatchObject({ date: "2026-07-16" });
    expect(
      result.diagnostics.map((d) => [d.severity, d.code, d.params]),
    ).toEqual([
      [
        "warning",
        "dateMovedToLjubljana",
        { date: "2026-07-16", utcDate: "2026-07-15" },
      ],
    ]);
  });

  it("refuses numbers of an absurd size", () => {
    const result = v4(
      "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,1234567890123456,69.5,USD,,,,1,EUR,,",
      "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF2,0.1234567890123,69.5,USD,,,,1,EUR,,",
    );
    expect(blocking(result)).toEqual([
      ["invalidNumber", 2],
      ["invalidNumber", 3],
    ]);
  });
});
