/**
 * The pipeline's output as the page sees it (ADR 0013 §4): the review's
 * figures as decimal strings at their display scale, findings with files by
 * position, per-file summaries and the dividend payers to ask about. Runs in
 * the worker; nothing it returns holds a `Decimal` or any other class.
 *
 * Amounts are written at the scale the forms use (cents for EUR, 8 decimals
 * for quantities and per-unit values), so the review shows the figures the
 * XML holds, rounded the same way (ADR 0006).
 */
import {
  Decimal,
  HOLDING_BUCKETS,
  isFileRef,
  type Diagnostic,
  type FileId,
  type IsoDate,
  type LedgerEvent,
  type Money as CoreMoney,
} from "@taxreporter/core";
import {
  fursCountryFromIso,
  type BuiltDividend,
  type BuiltList,
  type BuiltLot,
  type BuiltRow,
} from "@taxreporter/furs";
import type { BsiRate } from "@taxreporter/fx";
import type { Prepared, ReadExports } from "@taxreporter/pipeline";

import {
  BROKERS,
  type BrokerId,
  type DividendRow,
  type Finding,
  type FindingParam,
  type ImportedFile,
  type KdvpRow,
  type MatchedLot,
  type Money,
  type RateProvenance,
  type ReturnPreview,
  type SecurityResult,
} from "../model/preview";
import type { FileSummary, PayerPrompt } from "./protocol";

/** The request's files: their names by position, and positions by ID. */
export interface FileIndex {
  readonly names: readonly string[];
  readonly byId: ReadonlyMap<FileId, number>;
}

export function fileIndex(
  read: ReadExports,
  names: readonly string[],
): FileIndex {
  const byId = new Map<FileId, number>();
  for (const { file, fileId } of read.imports) {
    const position = names.indexOf(file);
    if (position >= 0 && !byId.has(fileId)) byId.set(fileId, position);
  }
  return { names, byId };
}

function positionOf(index: FileIndex, fileId: FileId): number {
  const position = index.byId.get(fileId);
  // Every event and finding comes from a file the request named.
  if (position === undefined) throw new Error("A file outside the request");
  return position;
}

const nameOf = (index: FileIndex, fileId: FileId) =>
  index.names[positionOf(index, fileId)] ?? "";

const isUntrusted = (value: unknown): value is { untrusted: string } =>
  typeof value === "object" &&
  value !== null &&
  "untrusted" in value &&
  typeof value.untrusted === "string";

/** A finding with its files as positions and its file text still marked. */
export function toFinding(d: Diagnostic, index: FileIndex): Finding {
  const params: Record<string, FindingParam> = {};
  for (const [name, value] of Object.entries(d.params) as [string, unknown][]) {
    if (typeof value === "string" || typeof value === "number") {
      params[name] = value;
    } else if (isFileRef(value)) {
      params[name] = { file: positionOf(index, value.file) };
    } else if (isUntrusted(value)) {
      params[name] = { untrusted: value.untrusted };
    } else {
      throw new TypeError("A finding parameter of an unexpected type");
    }
  }
  return {
    severity: d.severity,
    code: d.code,
    params,
    ...(d.source === undefined
      ? {}
      : {
          source: {
            file: positionOf(index, d.source.fileId),
            row: d.source.row,
          },
        }),
  };
}

function brokerId(broker: string): BrokerId {
  // A broker the page cannot name would be a new adapter without its UI.
  if (!(BROKERS as readonly string[]).includes(broker)) {
    throw new Error("A broker the web app does not know");
  }
  return broker as BrokerId;
}

const cents = (value: Decimal) => value.toFixed(2, "halfUp");
const eight = (value: Decimal) => value.toPlain(8, "halfUp");
const sum = <T>(items: readonly T[], value: (item: T) => Decimal) =>
  Decimal.sum(items.map(value));

/** Where an amount's rate came from, or null for an amount in euros. */
function toRate(rate: BsiRate): RateProvenance | null {
  if (rate.source === "eur") return null;
  // The list's own currency and value, exactly as published: GBX amounts
  // are converted at the GBP list (research 03).
  return {
    currency: rate.listCurrency,
    rate: rate.published,
    listDate: rate.listDate,
    source: rate.source,
  };
}

const toMoney = (money: CoreMoney): Money => ({
  amount: eight(money.amount),
  currency: money.currency,
});

/** "4:1", or "1:10" for a reverse split, from shares per traded share. */
function ratioOf(factor: Decimal): string {
  return factor.lessThan(Decimal.ONE)
    ? `1:${Decimal.ONE.dividedBy(factor).toPlain(4, "halfUp")}`
    : `${factor.toPlain(4, "halfUp")}:1`;
}

/** The split dates of each security, from the checked ledger. */
function splitDates(
  events: readonly LedgerEvent[],
): ReadonlyMap<string, readonly IsoDate[]> {
  const dates = new Map<string, IsoDate[]>();
  for (const event of events) {
    if (event.kind !== "split") continue;
    dates.set(event.isin, [...(dates.get(event.isin) ?? []), event.date]);
  }
  return dates;
}

function toRow(
  built: BuiltRow,
  isin: string,
  splits: ReadonlyMap<string, readonly IsoDate[]>,
  index: FileIndex,
): KdvpRow {
  const { row } = built;
  // The last split after the trade restated it; its date is what the
  // review names, with the ratio of every split since.
  const last = (splits.get(isin) ?? [])
    .filter((date) => date > row.date)
    .sort()
    .at(-1);
  return {
    kind: row.kind,
    date: row.date,
    quantity: eight(row.quantity),
    price: toMoney(built.price),
    rate: toRate(built.rate),
    priceEur: eight(
      row.kind === "purchase" ? row.unitCostEur : row.unitValueEur,
    ),
    broker: brokerId(built.broker),
    source: { file: nameOf(index, built.source.fileId), row: built.source.row },
    ...(built.splitFactor === undefined || last === undefined
      ? {}
      : { splitAdjusted: { ratio: ratioOf(built.splitFactor), date: last } }),
  };
}

const toLot = (lot: BuiltLot): MatchedLot => ({
  purchaseDate: lot.purchaseDate,
  saleDate: lot.saleDate,
  quantity: eight(lot.quantity),
  acquisitionEur: cents(lot.acquisitionEur),
  disposalEur: cents(lot.disposalEur),
  gainEur: cents(lot.gainEur),
  normedCostsEur: cents(lot.normedCostsEur),
  yearsHeld: lot.yearsHeld,
  bucket: lot.bucket,
});

function toSecurity(
  built: BuiltList,
  splits: ReadonlyMap<string, readonly IsoDate[]>,
  index: FileIndex,
): SecurityResult {
  const { list, lots } = built;
  const rows = built.rows.map((row) => toRow(row, list.isin, splits, index));
  return {
    isin: list.isin,
    symbol: list.ticker ?? "",
    name: list.name,
    brokers: BROKERS.filter((b) => rows.some((row) => row.broker === b)),
    rows,
    lots: lots.map(toLot),
    quantitySold: eight(sum(lots, (lot) => lot.quantity)),
    proceedsEur: cents(sum(lots, (lot) => lot.disposalEur)),
    costEur: cents(sum(lots, (lot) => lot.acquisitionEur)),
    gainEur: cents(sum(lots, (lot) => lot.gainEur)),
  };
}

/** FURS writes Greece as EL; ISO, and so the page's country names, as GR. */
const isoCountry = (furs: string) => (furs === "EL" ? "GR" : furs);

function toDividend(
  d: BuiltDividend,
  payerNames: ReadonlyMap<string, string>,
  index: FileIndex,
): DividendRow {
  const { isin } = d.security;
  const currency = d.gross.currency;
  // Tax withheld in the dividend's currency adds up; any other mix is shown
  // in euros only, as converted.
  const foreignTax: Money = d.withholdings.every((w) => w.currency === currency)
    ? { amount: eight(sum(d.withholdings, (w) => w.amount)), currency }
    : { amount: cents(d.foreignTaxEur), currency: "EUR" };
  return {
    date: d.date,
    symbol: d.security.symbol ?? "",
    payer: filled(
      d.record?.payer.name ?? payerNames.get(isin),
      filled(d.security.name, isin),
    ),
    isin,
    country: isoCountry(d.record?.payer.country ?? d.sourceCountry ?? ""),
    gross: toMoney(d.gross),
    foreignTax,
    rate: toRate(d.rate),
    grossEur: cents(d.grossEur),
    foreignTaxEur: cents(d.foreignTaxEur),
    creditEur: cents(d.credit.credit),
    treatyRate: d.treatyRate === null ? null : d.treatyRate.toString(),
    broker: brokerId(d.broker),
    source: { file: nameOf(index, d.source.fileId), row: d.source.row },
  };
}

/** The ticker of every security the ledger names, by ISIN. */
export function symbolsOf(
  events: readonly LedgerEvent[],
): Record<string, string> {
  const symbols: Record<string, string> = {};
  for (const event of events) {
    if (event.kind !== "trade" && event.kind !== "dividend") continue;
    const { isin, symbol } = event.security;
    if (symbol !== undefined && symbol !== "" && !(isin in symbols)) {
      symbols[isin] = symbol;
    }
  }
  return symbols;
}

/** Every finding of the run, from reading the files and from both builders. */
export function findingsOf(prepared: Prepared): readonly Diagnostic[] {
  return [
    ...prepared.ledger.diagnostics,
    ...prepared.kdvp.diagnostics,
    ...prepared.div.diagnostics,
  ];
}

export function toPreview(
  prepared: Prepared,
  taxYear: number,
  payerNames: ReadonlyMap<string, string>,
  index: FileIndex,
  summaries: readonly FileSummary[],
): ReturnPreview {
  const { kdvp, div } = prepared;
  const splits = splitDates(prepared.ledger.events);
  const securities = kdvp.lists.map((l) => toSecurity(l, splits, index));
  const allLots = kdvp.lists.flatMap((l) => l.lots);
  const dividends = div.dividends.map((d) => toDividend(d, payerNames, index));
  const year = String(taxYear);
  const months = Array.from(
    { length: 12 },
    (_, m) => `${year}-${String(m + 1).padStart(2, "0")}`,
  );
  const gains = kdvp.estimate;
  const byBucket = (values: Readonly<Record<string, Decimal>>) =>
    Object.fromEntries(
      HOLDING_BUCKETS.map((b) => [b, cents(values[b] ?? Decimal.ZERO)]),
    ) as ReturnPreview["gainsEstimate"]["positiveByBucket"];
  const files: ImportedFile[] = [];
  summaries.forEach((summary, position) => {
    const { broker, firstDate, lastDate } = summary;
    if (broker === null || firstDate === null || lastDate === null) return;
    files.push({
      name: index.names[position] ?? "",
      broker,
      firstDate,
      lastDate,
      rowsRead: summary.rows,
    });
  });
  return {
    taxYear,
    files,
    securities,
    dividends,
    findings: findingsOf(prepared).map((d) => toFinding(d, index)),
    symbols: symbolsOf(prepared.ledger.events),
    gainsTotals: {
      proceedsEur: cents(sum(allLots, (lot) => lot.disposalEur)),
      costEur: cents(sum(allLots, (lot) => lot.acquisitionEur)),
      gainEur: cents(sum(allLots, (lot) => lot.gainEur)),
    },
    gainsEstimate: {
      positiveByBucket: byBucket(gains.positiveByBucket),
      lossesEur: cents(gains.losses),
      netBaseEur: cents(gains.netBase),
      allocatedByBucket: byBucket(gains.allocatedByBucket),
      taxEur: cents(gains.tax),
    },
    dividendsEstimate: {
      taxRate: div.estimate.taxRate.toString(),
      grossEur: cents(div.estimate.grossEur),
      foreignTaxEur: cents(div.estimate.foreignTaxEur),
      creditEur: cents(div.estimate.creditEur),
      taxDueEur: cents(div.estimate.taxDueEur),
    },
    dividendsByMonth: months.map((month) => ({
      month,
      grossEur: cents(
        sum(
          div.dividends.filter((d) => d.date.startsWith(month)),
          (d) => d.grossEur,
        ),
      ),
    })),
  };
}

/** An account scope of a file that does not name its account: "broker:3". */
const GROUP_SCOPE = /^[a-z0-9]+:\d{1,4}$/;

/** What became of each file of the request, at its position. */
export function summarize(read: ReadExports, index: FileIndex): FileSummary[] {
  const { names } = index;
  const none: FileSummary = {
    status: "notRead",
    broker: null,
    firstDate: null,
    lastDate: null,
    rows: 0,
    sameAs: null,
    unnamedAccount: false,
    findings: [],
  };
  const summaries = names.map(() => none);
  for (const { file, result } of read.imports) {
    const position = names.indexOf(file);
    if (position < 0) continue;
    const findings = result.diagnostics.map((d) => toFinding(d, index));
    if (result.broker === "unknown") {
      summaries[position] = { ...none, status: "refused", findings };
      continue;
    }
    const dates = result.events
      .flatMap((e) => (e.kind === "ignored" ? [] : [e.date]))
      .concat(result.reach.map((r) => r.lastDate))
      .sort();
    summaries[position] = {
      ...none,
      status: "read",
      broker: brokerId(result.broker),
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      // Rows, not events: a dividend row with its tax is two events.
      rows: new Set(
        result.events.map(
          (e) => `${e.source.part ?? ""}:${String(e.source.row)}`,
        ),
      ).size,
      unnamedAccount: result.reach.some((r) => GROUP_SCOPE.test(r.account)),
      findings,
    };
  }
  for (const repeat of read.repeats) {
    const position = names.indexOf(repeat.file);
    if (position < 0) continue;
    summaries[position] = {
      ...none,
      status: "repeat",
      sameAs: names.indexOf(repeat.sameAs),
    };
  }
  for (const clash of read.clashes) {
    const position = names.indexOf(clash.file);
    if (position >= 0) summaries[position] = { ...none, status: "clash" };
  }
  return summaries;
}

/**
 * The findings about the files together: the ledger's, less those a single
 * file's reading already gave, which its summary shows.
 */
export function sessionFindings(
  ledger: readonly Diagnostic[],
  summaries: readonly FileSummary[],
  index: FileIndex,
): Finding[] {
  const ofFiles = new Set(
    summaries.flatMap((s) => s.findings).map((f) => JSON.stringify(f)),
  );
  return ledger
    .map((d) => toFinding(d, index))
    .filter((f) => !ofFiles.has(JSON.stringify(f)));
}

/**
 * The securities that paid a dividend in the tax year, whose payers Doh-Div
 * needs (ADR 0013 §8): the name the export gives, and the country the ISIN
 * names where FURS lists it.
 */
export function payerPrompts(
  events: readonly LedgerEvent[],
  taxYear: number,
): PayerPrompt[] {
  const year = `${String(taxYear)}-`;
  const prompts = new Map<string, PayerPrompt>();
  for (const event of events) {
    if (event.kind !== "dividend" || !event.date.startsWith(year)) continue;
    const { isin, symbol, name } = event.security;
    const seen = prompts.get(isin);
    prompts.set(isin, {
      isin,
      symbol: filled(seen?.symbol, symbol),
      name: filled(seen?.name, name),
      isinCountry: fursCountryFromIso(isin.slice(0, 2)) ?? "",
      payments: (seen?.payments ?? 0) + 1,
    });
  }
  const label = (p: PayerPrompt) => (p.symbol === "" ? p.isin : p.symbol);
  return [...prompts.values()].sort(
    (a, b) =>
      label(a).localeCompare(label(b), "en") || a.isin.localeCompare(b.isin),
  );
}

/** The first of two texts that says something, or "". */
function filled(first: string | undefined, second: string | undefined) {
  return first !== undefined && first !== "" ? first : (second ?? "");
}
