/**
 * Which Banka Slovenije rate converts an amount on a given day.
 *
 * Every foreign amount is converted at the rate published by Banka Slovenije
 * that is valid on the day of the event (ZDoh-2 Arts. 16(6), 98(9), 99(3)).
 * BSI quotes units of foreign currency per 1 EUR, so EUR = amount / rate.
 * The rules below, and why, are in docs/research/03-bsi-exchange-rates.md
 * §9 and §10; this module returns the rate with its provenance (which list,
 * of which date, the published string) so every converted amount can show it.
 */
import { Decimal } from "@taxreporter/core";

import { isIsoDate, parseSnapshotCsv, type SnapshotTable } from "./snapshot.js";

/**
 * BSI publishes only on TARGET days, and a day without a list takes the last
 * list published before it. The longest real gap is 5 days (Easter); past 10
 * the data is missing, and the lookup fails loudly rather than reach further
 * back (CLAUDE.md, "Tax correctness").
 */
export const MAX_LOOKBACK_DAYS = 10;

/**
 * Irrevocable euro conversion rates, from the day each currency joined the
 * euro (research 03 §10). After that day BSI lists no rate for them.
 */
export const EURO_CHANGEOVERS: Readonly<
  Record<string, { readonly from: string; readonly rate: string }>
> = {
  BGN: { from: "2026-01-01", rate: "1.95583" },
  HRK: { from: "2023-01-01", rate: "7.53450" },
  LTL: { from: "2015-01-01", rate: "3.45280" },
  LVL: { from: "2014-01-01", rate: "0.702804" },
  EEK: { from: "2011-01-01", rate: "15.6466" },
  SKK: { from: "2009-01-01", rate: "30.1260" },
  CYP: { from: "2008-01-01", rate: "0.585274" },
  MTL: { from: "2008-01-01", rate: "0.429300" },
};

/**
 * Quotes in a currency's minor unit, as brokers write them: pence for London
 * listings, cents for Johannesburg, agorot for Tel Aviv. GBX 100 is GBP 1, so
 * the GBX rate is the GBP rate times 100.
 */
export const MINOR_UNITS: Readonly<
  Record<string, { readonly currency: string; readonly per: string }>
> = {
  GBX: { currency: "GBP", per: "100" },
  GBp: { currency: "GBP", per: "100" },
  ZAc: { currency: "ZAR", per: "100" },
  ZAC: { currency: "ZAR", per: "100" },
  ILA: { currency: "ILS", per: "100" },
};

/**
 * The monthly list prices metals in EUR per gram, the inverse of every
 * currency on it, so they are never treated as currencies (research 03 §5).
 */
const METALS: ReadonlySet<string> = new Set(["XAU", "XAG", "XPT", "XPD"]);

/**
 * Days on which BSI's published rate differs from the ECB reference rate it
 * copies (research 03 §8). The law names BSI, so BSI's value is used and the
 * user is told.
 */
export const KNOWN_DISCREPANCIES: readonly {
  readonly date: string;
  readonly currency: string;
  readonly bsi: string;
  readonly ecb: string;
}[] = [
  { date: "2008-10-14", currency: "JPY", bsi: "141.52", ecb: "141.25" },
  { date: "2010-03-04", currency: "HUF", bsi: "266.02", ecb: "266.5" },
  { date: "2013-06-24", currency: "BGN", bsi: "1.9560", ecb: "1.9558" },
  { date: "2013-12-31", currency: "LVL", bsi: "0.7028", ecb: "0.702804" },
  { date: "2014-02-03", currency: "SGD", bsi: "1.7341", ecb: "1.7212" },
  { date: "2025-10-23", currency: "NOK", bsi: "11.8529", ecb: "11.5829" },
];

export type RateSource =
  "eur" | "bsi-daily" | "bsi-monthly" | "euro-changeover";

export interface BsiRate {
  /** The currency asked for, e.g. "GBX". */
  readonly currency: string;
  /** The currency of the published rate, e.g. "GBP" for GBX. */
  readonly listCurrency: string;
  /** Units of `currency` per 1 EUR: divide an amount by it to get EUR. */
  readonly rate: Decimal;
  /** The rate exactly as published, for display; "1" for EUR. */
  readonly published: string;
  /** The date of the list used: the event date or the last list before it. */
  readonly listDate: string;
  readonly source: RateSource;
  /** Set when BSI's value that day differs from the ECB's. */
  readonly ecbRate?: string;
}

export type RateError =
  | "invalidDate"
  | "metal"
  | "unknownCurrency"
  | "beforeSnapshot"
  | "afterSnapshot"
  | "noRate";

export type RateResult =
  | { readonly ok: true; readonly rate: BsiRate }
  | { readonly ok: false; readonly error: RateError };

function daysBetween(earlier: string, later: string): number {
  return (
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
    86_400_000
  );
}

export class RateTable {
  readonly #daily: SnapshotTable;
  readonly #monthly: SnapshotTable;
  readonly #dailyColumn: ReadonlyMap<string, number>;
  readonly #monthlyColumn: ReadonlyMap<string, number>;
  readonly #monthlyRow: ReadonlyMap<string, number>;
  /** The last day the snapshot can answer for (see `fromCsv`). */
  readonly completeThrough: string;

  private constructor(
    daily: SnapshotTable,
    monthly: SnapshotTable,
    completeThrough: string,
  ) {
    this.#daily = daily;
    this.#monthly = monthly;
    this.#dailyColumn = new Map(daily.codes.map((code, i) => [code, i]));
    this.#monthlyColumn = new Map(monthly.codes.map((code, i) => [code, i]));
    this.#monthlyRow = new Map(monthly.rows.map((row, i) => [row.key, i]));
    this.completeThrough = completeThrough;
  }

  /**
   * A table over the two snapshot files. `completeThrough` is the last day
   * whose list, if BSI published one, is certain to be in the daily file: a
   * later date may have a list the snapshot has not seen yet, so it is
   * refused rather than answered with an older list.
   */
  static fromCsv(
    dailyCsv: string,
    monthlyCsv: string,
    completeThrough: string,
  ): RateTable {
    if (!isIsoDate(completeThrough)) {
      throw new Error("Bad completeThrough date for the rate snapshot");
    }
    return new RateTable(
      parseSnapshotCsv(dailyCsv, "daily"),
      parseSnapshotCsv(monthlyCsv, "monthly"),
      completeThrough,
    );
  }

  /** The rate that converts an amount in `currency` on `date` to EUR. */
  lookup(currency: string, date: string): RateResult {
    if (!isIsoDate(date)) return { ok: false, error: "invalidDate" };
    if (currency === "EUR") {
      return {
        ok: true,
        rate: {
          currency,
          listCurrency: "EUR",
          rate: Decimal.ONE,
          published: "1",
          listDate: date,
          source: "eur",
        },
      };
    }
    if (METALS.has(currency)) return { ok: false, error: "metal" };
    const minor = MINOR_UNITS[currency];
    const result = this.#lookupListed(minor?.currency ?? currency, date);
    if (!result.ok || minor === undefined) return result;
    return {
      ok: true,
      rate: {
        ...result.rate,
        currency,
        rate: result.rate.rate.times(Decimal.parse(minor.per)),
      },
    };
  }

  #lookupListed(currency: string, date: string): RateResult {
    const changeover = EURO_CHANGEOVERS[currency];
    if (changeover !== undefined && date >= changeover.from) {
      return {
        ok: true,
        rate: {
          currency,
          listCurrency: currency,
          rate: Decimal.parse(changeover.rate),
          published: changeover.rate,
          listDate: changeover.from,
          source: "euro-changeover",
        },
      };
    }
    const first = this.#daily.rows[0]?.key;
    if (first === undefined || date < first) {
      return { ok: false, error: "beforeSnapshot" };
    }
    if (date > this.completeThrough)
      return { ok: false, error: "afterSnapshot" };

    const daily = this.#fromDaily(currency, date);
    if (daily !== null) return { ok: true, rate: daily };
    const monthly = this.#fromMonthly(currency, date);
    if (monthly !== null) return { ok: true, rate: monthly };
    return {
      ok: false,
      error:
        this.#dailyColumn.has(currency) || this.#monthlyColumn.has(currency)
          ? "noRate"
          : "unknownCurrency",
    };
  }

  /** The last daily list on or before `date` that has the currency, within the lookback. */
  #fromDaily(currency: string, date: string): BsiRate | null {
    const column = this.#dailyColumn.get(currency);
    if (column === undefined) return null;
    const rows = this.#daily.rows;
    // Binary search for the last list dated on or before `date`.
    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((rows[middle]?.key ?? "") <= date) low = middle;
      else high = middle - 1;
    }
    for (let i = low; i >= 0; i -= 1) {
      const row = rows[i];
      if (row === undefined || row.key > date) continue;
      if (daysBetween(row.key, date) > MAX_LOOKBACK_DAYS) return null;
      const published = row.rates[column];
      if (published === undefined) continue;
      const discrepancy = KNOWN_DISCREPANCIES.find(
        (known) => known.date === row.key && known.currency === currency,
      );
      return {
        currency,
        listCurrency: currency,
        rate: Decimal.parse(published),
        published,
        listDate: row.key,
        source: "bsi-daily",
        ...(discrepancy === undefined ? {} : { ecbRate: discrepancy.ecb }),
      };
    }
    return null;
  }

  /**
   * The monthly list valid for the date's month: the one whose `veljavnost`
   * is the 1st of that month (research 03 §5, §10).
   */
  #fromMonthly(currency: string, date: string): BsiRate | null {
    const column = this.#monthlyColumn.get(currency);
    const index = this.#monthlyRow.get(`${date.slice(0, 7)}-01`);
    if (column === undefined || index === undefined) return null;
    const row = this.#monthly.rows[index];
    const published = row?.rates[column];
    if (row === undefined || published === undefined) return null;
    return {
      currency,
      listCurrency: currency,
      rate: Decimal.parse(published),
      published,
      listDate: row.key,
      source: "bsi-monthly",
    };
  }
}

/** EUR for an amount at a rate: amount / rate, exact until a form field rounds it. */
export function toEur(amount: Decimal, rate: BsiRate): Decimal {
  return amount.dividedBy(rate.rate);
}
