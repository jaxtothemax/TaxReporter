/**
 * The Trading 212 adapter against one synthetic export per header revision
 * (test/fixtures/trading212/README.md), and against the rows it must refuse.
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
import { splitRatio } from "./trading212.js";

const fixture = (file: string) =>
  readFileSync(
    new URL(`../test/fixtures/trading212/${file}`, import.meta.url),
    "utf8",
  );

/** An export's text, imported as its bytes into account group 1. */
function read(text: string): ImportResult {
  const bytes = new TextEncoder().encode(text);
  return importFile({ bytes, fileId: fileIdOf(bytes), accountGroup: 1 });
}

const imported = (file: string) => read(fixture(file));

const V4_HEADER =
  "Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax)";

/** A V4 export of the given rows (17 columns each). */
const v4 = (...rows: string[]) => read([V4_HEADER, ...rows].join("\n"));

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
    expect(result.reach).toEqual([
      { account: "trading212:1", lastDate: "2026-09-10" },
    ]);
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
        params: { broker: "trading212", count: 1 },
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
      "ignored:cardSpending",
    ]);
  });
});

describe("a takeover paid in shares, under a real export's header", () => {
  // V4 as a real export writes it: no Notes column when no row has a note.
  // The rows are made up (test/fixtures/trading212/README.md).
  const result = imported("t212-invest-v4-2026-takeover.csv");

  it("refuses the takeover's two rows and the rights, and reads the rest", () => {
    expect(result.format).toBe("trading212-csv-v4");
    // The sale priced "0E-10" is refused as a sale at zero, the mark of a
    // takeover paid in shares (06 §4.3), not as a number it cannot read.
    expect(
      result.diagnostics.map((d) => [d.code, d.params, d.source?.row]),
    ).toEqual([
      [
        "unsupportedAction",
        { broker: "trading212", action: "Custom stock distribution" },
        3,
      ],
      ["invalidPrice", {}, 6],
      [
        "unsupportedAction",
        { broker: "trading212", action: "Stock distribution" },
        7,
      ],
    ]);
    expect(kinds(result)).toEqual([
      "trade",
      "dividend",
      "withholding",
      "dividend",
      "trade",
    ]);
    expect(accountedRows(result)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("reads dividends priced to 6 decimals, and a tax of 0.00 as none", () => {
    const gross = result.events.flatMap((e) =>
      e.kind === "dividend" ? [e.gross.amount.toString()] : [],
    );
    // 10 x 0.4335 net + 0.77 withheld; 30 x 0.62, nothing withheld.
    expect(gross).toEqual(["5.105", "18.6"]);
  });
});

describe("dividends a broker labels Bonus or Demerger", () => {
  const bonus = `Dividend (Bonus),2026-04-01 12:10:44+00:00,US1912161007,KO,Coca-Cola,,,20,0.85,USD,,,,11.5,EUR,3,USD`;
  const demerger = `Dividend (Demerger),2026-04-02 12:10:44+00:00,US1912161007,KO,Coca-Cola,,,2,1.5,USD,,,,2.5,EUR,0.00,USD`;

  it("reads both as ordinary dividends, and warns on each row", () => {
    const result = v4(bonus, demerger);
    expect(kinds(result)).toEqual(["dividend", "withholding", "dividend"]);
    // 20 x 0.85 net + 3 withheld; 2 x 1.5, nothing withheld (06 §4.3).
    const gross = result.events.flatMap((e) =>
      e.kind === "dividend" ? [e.gross.amount.toString()] : [],
    );
    expect(gross).toEqual(["20", "3"]);
    expect(
      result.diagnostics.map((d) => [
        d.severity,
        d.code,
        d.params,
        d.source?.row,
      ]),
    ).toEqual([
      [
        "warning",
        "dividendLabelTreated",
        { broker: "trading212", label: "bonus" },
        2,
      ],
      [
        "warning",
        "dividendLabelTreated",
        { broker: "trading212", label: "demerger" },
        3,
      ],
    ]);
    expect(blocking(result)).toEqual([]);
  });

  it("warns only on a row it reads, never on one it refuses", () => {
    const refused =
      "Dividend (Bonus),2026-04-01 12:10:44+00:00,US1912161007,KO,Coca-Cola,,,20,0.85,USD,,,,11.5,EUR,-3,USD";
    const result = v4(refused);
    expect(blocking(result)).toEqual([["unexpectedSign", 2]]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["unexpectedSign"]);
    expect(result.events).toEqual([]);
  });

  it("keeps them apart from an ordinary dividend of the same figures", () => {
    const ordinary = bonus.replace("Dividend (Bonus)", "Dividend (Dividend)");
    const keys = new Set(
      v4(bonus, ordinary).events.map((e) => ("key" in e ? e.key : "")),
    );
    // Two dividends and two withholdings, none of them one event twice.
    expect(keys.size).toBe(4);
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
    // The action is the file's text: the finding carries it only wrapped,
    // for the screen, and every export drops it.
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      [
        "unknownAction",
        { broker: "trading212", action: { untrusted: "Gift card" } },
      ],
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
    const empty = read(`${header}\n${BUY},`);
    expect(empty.diagnostics).toEqual([]);
    const filled = read(`${header}\n${BUY},1`);
    // The column by its position; its name is the file's text, so it is
    // carried only wrapped, for the screen.
    expect(filled.diagnostics).toEqual([
      {
        severity: "blocking",
        code: "unknownColumn",
        params: {
          broker: "trading212",
          position: 18,
          column: { untrusted: "Bonus" },
        },
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

  it('zero written "0E-10" in a share count or a price, and no other exponent', () => {
    const result = v4(
      "Market sell,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0E-10,USD,,-50,EUR,0.00,EUR,,",
      "Market buy,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,0E-10,69.5,USD,,,,1,EUR,,",
      "Market buy,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,1.230E-7,USD,,,,1,EUR,,",
      "Market buy,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0E-10x,USD,,,,1,EUR,,",
      "Market buy,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0e-10,USD,,,,1,EUR,,",
      "Market buy,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0E-6,USD,,,,1,EUR,,",
      "Dividend (Dividend),2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,,20,0.4335,USD,,,,7.41,EUR,0E-10,USD",
      "Market buy,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,USD,,,,0E-10,EUR,,",
      "Market sell,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0E-7,USD,,-50,EUR,0.00,EUR,,",
      "Market sell,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0E-12,USD,,-50,EUR,0.00,EUR,,",
      "Market buy,2026-09-08 14:05:12+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,0E-13,USD,,,,1,EUR,,",
    );
    const price = { column: "Price / share" };
    // A zero price is the mark of a takeover paid in shares (06 §4.3), and a
    // zero share count no quantity. A tax or a total is kept to 2 decimals,
    // so there the form is not a zero T212 writes. The form runs from 7
    // places, the first written so, to 12, the most NUMBER takes.
    expect(
      result.diagnostics.map((d) => [d.code, d.params, d.source?.row]),
    ).toEqual([
      ["invalidPrice", {}, 2],
      ["invalidQuantity", {}, 3],
      ["invalidNumber", price, 4],
      ["invalidNumber", price, 5],
      ["invalidNumber", price, 6],
      ["invalidNumber", price, 7],
      ["invalidNumber", { column: "Withholding tax" }, 8],
      ["invalidNumber", { column: "Total" }, 9],
      ["invalidPrice", {}, 10],
      ["invalidPrice", {}, 11],
      ["invalidNumber", price, 12],
    ]);
    expect(result.events).toEqual([]);
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

  it('split halves with "0E-10": a share count is refused first, a price is not used', () => {
    const half = (action: string, time: string, shares: string) =>
      `${action},${time},US00000ACME1,ACME,Acme Corp,,,${shares},0E-10,USD,,,,775.86,EUR,,`;
    const result = v4(
      half("Stock split close", "2026-03-02 07:00:00", "0E-10"),
      half("Stock split open", "2026-03-02 07:00:00", "9"),
      half("Stock split close", "2026-04-02 07:00:00", "3"),
      half("Stock split open", "2026-04-02 07:00:00", "9"),
    );
    // Refused as a quantity, the zero never reaches the ratio, which reads
    // a share count's own text; a split's price is not used, so a zero
    // there, in either form, leaves the split as it is.
    expect(blocking(result)).toEqual([
      ["invalidQuantity", 2],
      ["splitUnpaired", 3],
    ]);
    expect(kinds(result)).toEqual(["split", "ignored:pairedRow"]);
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
      params: { dropped: 200 },
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
      read("RecordType,Date,Amount\nX,2026-01-01,5\n").diagnostics,
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
    const text = fixture("t212-invest-v4-2026.csv");
    const first = read(text);
    // The same rows in another file: an export that ends with a blank line.
    const second = read(`${text}\n`);
    expect(second.events[0]?.source.fileId).not.toBe(
      first.events[0]?.source.fileId,
    );
    const all: LedgerEvent[] = [...first.events, ...second.events];
    const ledger = validateLedger(all);
    const keyed = first.events.filter((e) => e.kind !== "ignored").length;
    expect(ledger.diagnostics).toEqual([
      {
        severity: "info",
        code: "duplicatesRemoved",
        params: { count: keyed },
      },
    ]);
    expect(ledger.events.length).toBe(all.length - keyed);
  });

  it("keep two identical rows of one file apart: they are two fills", () => {
    const row =
      "Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,USD,,,,118.55,EUR,,";
    const result = v4(row, row);
    const keys = result.events.map((e) => (e.kind === "ignored" ? "" : e.key));
    expect(new Set(keys).size).toBe(2);
    expect(validateLedger(result.events).diagnostics).toEqual([]);
  });
});

describe("what an import holds", () => {
  it("orders a day's purchases by their time, whatever the action", () => {
    // A market buy in the morning, a limit buy in the afternoon: FIFO sells
    // the morning's shares first, though "Limit" sorts before "Market".
    const result = v4(
      "Limit buy,2026-02-03 14:00:00+00:00,US1912161007,KO,Coca-Cola,,EOF2,10,130,USD,,,,1,EUR,,",
      "Market buy,2026-02-03 08:00:00+00:00,US1912161007,KO,Coca-Cola,,EOF1,10,100,USD,,,,1,EUR,,",
      "Market sell,2026-05-04 12:00:00+00:00,US1912161007,KO,Coca-Cola,,EOF3,15,120,USD,,,,1,EUR,,",
    );
    const fifo = matchFifo(validateLedger(result.events));
    const sale = fifo.securities.get("US1912161007")?.disposals[0];
    expect(
      sale?.matches.map((m) => [
        m.purchase.price.amount.toString(),
        m.quantity.toString(),
      ]),
    ).toEqual([
      ["100", "10"],
      ["130", "5"],
    ]);
    expect(fifo.diagnostics).toEqual([]);
  });

  it("names a column by the adapter's name, never by the header the file wrote", () => {
    const header =
      "Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total (XYZ)";
    const result = read(
      `${header}\nMarket buy,2022-03-02 10:00:00,US1912161007,KO,Coca-Cola,1,50,USD,1e3\n`,
    );
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["invalidNumber", { column: "Total" }],
    ]);
  });

  it("names the file by its ID and puts every row in the file's account", () => {
    const text = fixture("t212-invest-v4-2026.csv");
    const bytes = new TextEncoder().encode(text);
    const result = importFile({
      bytes,
      fileId: fileIdOf(bytes),
      accountGroup: 2,
    });
    expect(new Set(result.events.map((e) => e.source.fileId))).toEqual(
      new Set([fileIdOf(bytes)]),
    );
    expect(new Set(result.events.map((e) => e.account))).toEqual(
      new Set(["trading212:2"]),
    );
    expect(validateLedger(result.events).diagnostics).toEqual([]);
  });

  it("keeps the broker's clock beside each date", () => {
    const [buy] = v4(
      "Market buy,2026-07-15 22:30:00.123+00:00,US1912161007,KO,Coca-Cola,,EOF1,2,69.5,USD,,,,118.55,EUR,,",
    ).events;
    expect(buy).toMatchObject({
      date: "2026-07-16",
      at: { instant: "2026-07-15T22:30:00Z", brokerDate: "2026-07-15" },
    });
  });

  it("keeps order IDs and notes out of every key and exported finding", () => {
    const canary = (n: number) => `CANARY${String(n)}`;
    const result = v4(
      `Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,${canary(1)},${canary(2)},2,69.5,USD,,,,118.55,EUR,,`,
      `Gift card,2026-01-06 14:31:02+00:00,,,,${canary(3)},${canary(4)},,,,,,,5,EUR,,`,
      `Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,Coca-Cola,,${canary(5)},x,69.5,USD,,,,1,EUR,,`,
    );
    const keys = result.events.map((e) => (e.kind === "ignored" ? "" : e.key));
    const exported = result.diagnostics.map(forExport);
    expect(JSON.stringify([keys, exported])).not.toContain("CANARY");
    expect(exported.map((d) => d.code)).toEqual([
      "unknownAction",
      "invalidNumber",
    ]);
  });
});

describe("importFile", () => {
  it("refuses a CFD account's export by name", () => {
    const result = read(
      "RecordType,Time,Ticker,Quantity\nCLOSED_POSITION,2026-01-06 14:31:02,KO,2\n",
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "derivativesNotSupported",
    ]);
  });

  it("refuses a file no adapter knows, or that is not CSV at all", () => {
    expect(read("Date,Amount\n2026-01-01,5\n").diagnostics).toEqual([
      { severity: "blocking", code: "unknownFormat", params: {} },
    ]);
    expect(read('A,B\n"open\n').diagnostics).toEqual([
      {
        severity: "blocking",
        code: "unreadableFile",
        params: { reason: "unterminatedQuote", row: 2 },
      },
    ]);
    // XML goes to the XML family, which has no adapter yet.
    expect(read(" \n<FlexQueryResponse/>").diagnostics).toEqual([
      { severity: "blocking", code: "unknownFormat", params: {} },
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
