/**
 * The rate snapshot TaxReporter ships, as two CSV files built from BSI's
 * history files: one row per list, one column per currency, every rate the
 * exact string BSI published (trailing zeros kept), an empty cell where a
 * list has no rate for a currency. BSI's terms allow redistribution with the
 * source named and the values unchanged (research 03 §12); the CSV changes
 * the format only, never a value.
 *
 * Building checks the invariants a format change or a bad download would
 * break (research 03 §13), and reading checks the shape again, because the
 * snapshot is data the app trusts.
 */
import { isIsoDate } from "@taxreporter/core";

import type { PublishedList } from "./bsi-xml.js";

// The project's one date check, in core; re-exported where fx offered it.
export { isIsoDate };

const CODE = /^[A-Z]{3}$/;
const RATE = /^\d{1,12}(?:\.\d{1,12})?$/;

/** Bounds for reading a snapshot: far above the real files, which are ~1.3 MB. */
const MAX_SNAPSHOT_LENGTH = 16 * 1024 * 1024;
const MAX_ROWS = 40_000;

function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function decimals(rate: string): number {
  return rate.split(".")[1]?.length ?? 0;
}

/**
 * Daily currencies whose decimal count BSI changed: LTL has 5 decimals on 16
 * lists and 4 on the rest (research 03 §4). Any other change stops the build.
 */
const VARYING_DECIMALS: ReadonlySet<string> = new Set(["LTL"]);

function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;
}

/** The daily snapshot, after checking dates, weekdays and decimals. */
export function dailyCsv(lists: readonly PublishedList[]): string {
  const codes = new Set<string>();
  const places = new Map<string, number>();
  let previous = "";
  for (const list of lists) {
    if (!isIsoDate(list.date)) throw new Error("Daily list with a bad date");
    if (list.date <= previous) {
      throw new Error(`Daily lists out of order at ${list.date}`);
    }
    previous = list.date;
    const day = weekday(list.date);
    if (day === 0 || day === 6) {
      throw new Error(`Daily list on a weekend: ${list.date}`);
    }
    for (const [code, rate] of list.rates) {
      codes.add(code);
      const seen = places.get(code);
      if (
        seen !== undefined &&
        seen !== decimals(rate) &&
        !VARYING_DECIMALS.has(code)
      ) {
        throw new Error(`Decimal places of ${code} changed on ${list.date}`);
      }
      places.set(code, decimals(rate));
    }
  }
  const columns = [...codes].sort();
  return toCsv(
    ["date", ...columns],
    lists.map((list) => [
      list.date,
      ...columns.map((code) => list.rates.get(code) ?? ""),
    ]),
  );
}

/**
 * The monthly snapshot. BSI split ten lists of 2008–2009 into two elements
 * with the same dates, one holding a single renamed currency; they are merged
 * here, never overwritten (research 03 §5).
 */
export function monthlyCsv(lists: readonly PublishedList[]): string {
  const merged = new Map<
    string,
    { date: string; rates: Map<string, string> }
  >();
  for (const list of lists) {
    const validFrom = list.validFrom;
    if (
      validFrom === undefined ||
      !isIsoDate(validFrom) ||
      !validFrom.endsWith("-01") ||
      !isIsoDate(list.date)
    ) {
      throw new Error("Monthly list with a bad date");
    }
    const target = merged.get(validFrom);
    if (target === undefined) {
      merged.set(validFrom, { date: list.date, rates: new Map(list.rates) });
      continue;
    }
    if (target.date !== list.date) {
      throw new Error(`Two monthly lists valid from ${validFrom}`);
    }
    for (const [code, rate] of list.rates) {
      if (target.rates.has(code)) {
        throw new Error(`${code} twice in the monthly list of ${validFrom}`);
      }
      target.rates.set(code, rate);
    }
  }
  const months = [...merged.keys()].sort();
  const columns = [
    ...new Set([...merged.values()].flatMap((list) => [...list.rates.keys()])),
  ].sort();
  return toCsv(
    ["valid_from", "date", ...columns],
    months.map((month) => {
      const list = merged.get(month);
      return [
        month,
        list?.date ?? "",
        ...columns.map((code) => list?.rates.get(code) ?? ""),
      ];
    }),
  );
}

export interface SnapshotTable {
  /** Column codes, in file order. */
  readonly codes: readonly string[];
  readonly rows: readonly {
    /** The first cell: `date` (daily) or `valid_from` (monthly). */
    readonly key: string;
    /** Monthly only: the list's own `datum`. */
    readonly date?: string;
    /** Indexed like `codes`; undefined where the list has no rate. */
    readonly rates: readonly (string | undefined)[];
  }[];
}

/** Reads a snapshot CSV back, checking every cell. */
export function parseSnapshotCsv(
  text: string,
  kind: "daily" | "monthly",
): SnapshotTable {
  if (text.length > MAX_SNAPSHOT_LENGTH) {
    throw new Error("Rate snapshot larger than expected");
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > MAX_ROWS + 1) throw new Error("Rate snapshot too long");
  const [headerLine, ...body] = lines;
  const lead = kind === "daily" ? ["date"] : ["valid_from", "date"];
  const header = headerLine?.split(",") ?? [];
  if (lead.some((name, i) => header[i] !== name)) {
    throw new Error(`Not a ${kind} rate snapshot`);
  }
  const codes = header.slice(lead.length);
  if (!codes.every((code) => CODE.test(code))) {
    throw new Error("Bad currency code in rate snapshot");
  }
  let previous = "";
  const rows = body.map((line) => {
    const cells = line.split(",");
    if (cells.length !== header.length) {
      throw new Error("Ragged row in rate snapshot");
    }
    const [key = "", second = ""] = cells;
    if (!isIsoDate(key) || key <= previous) {
      throw new Error("Bad or unordered date in rate snapshot");
    }
    previous = key;
    if (kind === "monthly" && !isIsoDate(second)) {
      throw new Error("Bad list date in rate snapshot");
    }
    const rates = cells.slice(lead.length).map((cell) => {
      if (cell === "") return undefined;
      if (!RATE.test(cell)) throw new Error("Bad rate in rate snapshot");
      return cell;
    });
    return kind === "monthly" ? { key, date: second, rates } : { key, rates };
  });
  return { codes, rows };
}
