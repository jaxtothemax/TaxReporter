/**
 * Known-answer tests against the committed snapshot (packages/fx/data), the
 * cases CLAUDE.md and docs/research/03-bsi-exchange-rates.md name, plus the
 * lookup's edge cases on a small synthetic table.
 */
import { readFileSync } from "node:fs";

import { Decimal } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import snapshot from "../data/snapshot.json" with { type: "json" };
import {
  MAX_LOOKBACK_DAYS,
  RateTable,
  toEur,
  type RateResult,
} from "./rates.js";

const data = (file: string) =>
  readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8");

const table = RateTable.fromCsv(
  data("bsi-daily.csv"),
  data("bsi-monthly.csv"),
  snapshot.completeThrough,
);

function rate(result: RateResult) {
  if (!result.ok) throw new Error(`no rate: ${result.error}`);
  return result.rate;
}

describe("BSI known answers", () => {
  it("uses BSI's NOK of 2025-10-23, not the ECB's, and says so", () => {
    const nok = rate(table.lookup("NOK", "2025-10-23"));
    expect(nok.published).toBe("11.8529");
    expect(nok.ecbRate).toBe("11.5829");
    expect(nok.source).toBe("bsi-daily");
  });

  it("takes Friday's list for a Saturday and Christmas Eve's for Christmas", () => {
    const saturday = rate(table.lookup("USD", "2025-10-25"));
    expect(saturday.listDate).toBe("2025-10-24");
    expect(rate(table.lookup("USD", "2025-12-25")).listDate).toBe("2025-12-24");
    // 1 May 2026 is a TARGET holiday: the demo's AT&T dividend.
    const mayDay = rate(table.lookup("USD", "2026-05-01"));
    expect([mayDay.listDate, mayDay.published]).toEqual([
      "2026-04-30",
      "1.1702",
    ]);
  });

  it("matches the rates the demo data shows", () => {
    expect(rate(table.lookup("USD", "2026-03-12")).published).toBe("1.1547");
    expect(rate(table.lookup("USD", "2019-08-14")).published).toBe("1.1188");
    expect(rate(table.lookup("GBP", "2026-03-20")).published).toBe("0.86438");
  });

  it("keeps the digits BSI published, trailing zeros included", () => {
    expect(rate(table.lookup("GBP", "2026-10-06")).published).toBe("0.84880");
  });

  it("uses the monthly list for currencies the daily list lacks", () => {
    const october = rate(table.lookup("TWD", "2025-10-15"));
    expect([october.published, october.source, october.listDate]).toEqual([
      "35.777",
      "bsi-monthly",
      "2025-10-01",
    ]);
    // Selected by validity, not by the list's own date (research 03 §5).
    expect(rate(table.lookup("TWD", "2025-07-31")).published).toBe("34.248");
  });

  it("falls back to the monthly list in the ISK gap of 2008 to 2018", () => {
    expect(rate(table.lookup("ISK", "2012-06-15")).source).toBe("bsi-monthly");
  });

  it("applies the irrevocable euro rate after a changeover", () => {
    const bgn = rate(table.lookup("BGN", "2026-01-02"));
    expect([bgn.published, bgn.source]).toEqual(["1.95583", "euro-changeover"]);
    expect(rate(table.lookup("BGN", "2025-12-31")).published).toBe("1.9558");
    expect(rate(table.lookup("HRK", "2023-06-01")).published).toBe("7.53450");
  });

  it("has no RUB after 2022-03-01, and says so instead of guessing", () => {
    expect(rate(table.lookup("RUB", "2022-03-01")).published).toBe("117.2010");
    expect(table.lookup("RUB", "2022-03-15")).toEqual({
      ok: false,
      error: "noRate",
    });
  });
});

describe("lookup rules", () => {
  it("converts pence quotes at the pound's rate times 100", () => {
    const gbx = rate(table.lookup("GBX", "2026-03-20"));
    expect(gbx.listCurrency).toBe("GBP");
    expect(gbx.rate.toString()).toBe("86.438");
    expect(toEur(Decimal.parse("1743"), gbx).toFixed(2, "halfUp")).toBe(
      "20.16",
    );
  });

  it("converts by dividing by the rate, exactly", () => {
    const usd = rate(table.lookup("USD", "2026-03-12"));
    expect(toEur(Decimal.parse("214.87"), usd).toFixed(8, "halfUp")).toBe(
      "186.08296527",
    );
  });

  it("knows EUR, refuses metals and unknown codes", () => {
    expect(rate(table.lookup("EUR", "2026-03-12")).rate.toString()).toBe("1");
    expect(table.lookup("XAU", "2026-03-12")).toEqual({
      ok: false,
      error: "metal",
    });
    expect(table.lookup("QQQ", "2026-03-12")).toEqual({
      ok: false,
      error: "unknownCurrency",
    });
  });

  it("refuses dates it cannot answer for", () => {
    expect(table.lookup("USD", "2006-12-29")).toEqual({
      ok: false,
      error: "beforeSnapshot",
    });
    expect(table.lookup("USD", "2026-10-08")).toEqual({
      ok: false,
      error: "afterSnapshot",
    });
    expect(table.lookup("USD", "2026-02-30")).toEqual({
      ok: false,
      error: "invalidDate",
    });
  });

  it(`never reaches back more than ${String(MAX_LOOKBACK_DAYS)} days`, () => {
    const gappy = RateTable.fromCsv(
      "date,USD\n2026-01-02,1.0000\n2026-01-20,1.1000\n",
      "valid_from,date\n",
      "2026-01-31",
    );
    expect(rate(gappy.lookup("USD", "2026-01-12")).listDate).toBe("2026-01-02");
    expect(gappy.lookup("USD", "2026-01-13")).toEqual({
      ok: false,
      error: "noRate",
    });
  });

  it("refuses a snapshot with a bad completeness date", () => {
    expect(() =>
      RateTable.fromCsv("date\n", "valid_from,date\n", "soon"),
    ).toThrow(/completeThrough/);
  });
});
