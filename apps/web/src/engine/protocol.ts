/**
 * The messages between the page and the engine worker (ADR 0013 §4–5).
 *
 * Plain data only: amounts, rates and quantities as decimal strings, a file
 * by its position in the request, no class instance and no error text. Both
 * sides check what they receive, and a message of another version or shape
 * is dropped, never half used. The worker is this app's own code, so the
 * checks guard against a stale script or a bug more than an attacker, but
 * they are complete: every field the screens read is checked for its shape
 * (decimals, dates, ISINs, closed lists), so a reply that passes renders.
 */
import { isIsin, isIsoDate } from "@taxreporter/core";
import type { AccountChoice } from "@taxreporter/pipeline";

import { isFindingCode } from "../i18n/present";
import {
  BROKERS,
  HOLDING_BUCKETS,
  type BrokerId,
  type DividendRow,
  type Finding,
  type FindingParam,
  type ImportedFile,
  type KdvpRow,
  type MatchedLot,
  type Money,
  type MonthlyAmount,
  type RateProvenance,
  type ReturnPreview,
  type SecurityResult,
} from "../model/preview";

export const PROTOCOL_VERSION = 1;

export interface RequestFile {
  /** The file's name, unique in the session: a label, never read for meaning. */
  readonly name: string;
  readonly bytes: ArrayBuffer;
}

/** The taxpayer's details as typed on the Details step. */
export interface TaxpayerDetails {
  readonly taxNumber: string;
  readonly name: string;
  readonly address: string;
  readonly postCode: string;
  readonly city: string;
  readonly email: string;
}

/** One dividend payer's details as typed on the Details step. */
export interface PayerDetails {
  readonly isin: string;
  readonly name: string;
  readonly address: string;
  /** The payer's FURS country code. */
  readonly country: string;
  /** Its ID abroad, or a Slovenian payer's tax number; "" when not known. */
  readonly id: string;
  /** The income's FURS country where the ISIN names none; "" otherwise. */
  readonly sourceCountry: string;
}

interface RequestBase {
  readonly v: typeof PROTOCOL_VERSION;
  readonly id: number;
  readonly files: readonly RequestFile[];
  readonly accounts: AccountChoice;
  readonly taxYear: number;
}

export type EngineRequest =
  | (RequestBase & { readonly kind: "read" })
  | (RequestBase & {
      readonly kind: "prepare";
      readonly taxpayer: TaxpayerDetails;
      readonly payers: readonly PayerDetails[];
    });

export type FileStatus = "read" | "refused" | "repeat" | "clash" | "notRead";

/** What became of one file of the request, at its position. */
export interface FileSummary {
  readonly status: FileStatus;
  /** The broker whose export it is, for a file that was read. */
  readonly broker: BrokerId | null;
  /** The first and last day its rows name, when it has any. */
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  /** Rows the adapter accounted for, as events or as ignored rows. */
  readonly rows: number;
  /** For a repeat, the position of the file it repeats. */
  readonly sameAs: number | null;
  /** Whether its broker's exports do not name their account (Trading 212). */
  readonly unnamedAccount: boolean;
  /** What reading this file alone found, its refusal included. */
  readonly findings: readonly Finding[];
}

/** A security that paid a dividend in the tax year, whose payer is asked for. */
export interface PayerPrompt {
  readonly isin: string;
  readonly symbol: string;
  /** The security's name as the export gives it; "" when it gives none. */
  readonly name: string;
  /** The FURS country the ISIN names; "" when it names none. */
  readonly isinCountry: string;
  /** The broker that paid every dividend of the security; "" when several did. */
  readonly broker: string;
  readonly payments: number;
}

/** One return as the download step offers it. */
export interface FormOutput {
  /** The XML eDavki imports, or null when it is withheld or not needed. */
  readonly xml: string | null;
  /** Blocking findings that withhold it. */
  readonly blocking: number;
  /** Whether the year has anything to file on it at all. */
  readonly needed: boolean;
}

interface ReplyBase {
  readonly v: typeof PROTOCOL_VERSION;
  readonly id: number;
}

export interface ReadReply extends ReplyBase {
  readonly kind: "read";
  readonly files: readonly FileSummary[];
  /** Findings about the files together: overlaps, repeats, shared events. */
  readonly findings: readonly Finding[];
  /** Findings left out of `findings`, the least severe first. */
  readonly omittedFindings: number;
  readonly payers: readonly PayerPrompt[];
  readonly symbols: Readonly<Record<string, string>>;
}

export interface PrepareReply extends ReplyBase {
  readonly kind: "prepare";
  readonly files: readonly FileSummary[];
  readonly preview: ReturnPreview;
  readonly kdvp: FormOutput;
  readonly div: FormOutput;
}

/** Something failed inside the engine: no detail, as it could hold file text. */
export interface FailedReply extends ReplyBase {
  readonly kind: "failed";
}

export type EngineReply = ReadReply | PrepareReply | FailedReply;

// Checks. Each takes `unknown` and narrows; none throws.

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isArrayOf = <T>(v: unknown, item: (x: unknown) => x is T): v is T[] =>
  Array.isArray(v) && v.every(item);
const isStringOrNull = (v: unknown): v is string | null =>
  v === null || isString(v);
const SEVERITIES = new Set(["blocking", "warning", "info"]);
const STATUSES = new Set(["read", "refused", "repeat", "clash", "notRead"]);
const isBroker = (v: unknown): v is BrokerId =>
  (BROKERS as readonly unknown[]).includes(v);

function isParam(v: unknown): v is FindingParam {
  if (isString(v)) return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  return (
    keys.length === 1 &&
    ((keys[0] === "file" && isCount(v["file"])) ||
      (keys[0] === "untrusted" && isString(v["untrusted"])))
  );
}

/** A section name, absent where the file numbers rows throughout. */
const isPart = (v: unknown): boolean =>
  v === undefined || (isString(v) && /^[A-Za-z]{1,40}$/.test(v));

export function isFinding(v: unknown): v is Finding {
  if (!isRecord(v)) return false;
  const { severity, code, params, source } = v;
  return (
    SEVERITIES.has(severity as string) &&
    isString(code) &&
    isFindingCode(code) &&
    isRecord(params) &&
    Object.values(params).every(isParam) &&
    (source === undefined ||
      (isRecord(source) &&
        isCount(source["file"]) &&
        isCount(source["row"]) &&
        isPart(source["part"])))
  );
}

// The shapes the formatters accept: a plain decimal, an ISO date.
const PLAIN_DECIMAL = /^-?\d{1,40}(\.\d{1,40})?$/;
/** A month of a year: the formatters would roll "2026-13" into 2027. */
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;

const isDecimal = (v: unknown): v is string =>
  isString(v) && PLAIN_DECIMAL.test(v);
/** A real calendar date, which the formatters would otherwise roll over. */
const isDate = (v: unknown): v is string => isString(v) && isIsoDate(v);
const isDateOrNull = (v: unknown): v is string | null =>
  v === null || isDate(v);
const isAnIsin = (v: unknown): v is string => isString(v) && isIsin(v);
const decimals = (v: Rec, ...names: readonly string[]) =>
  names.every((name) => isDecimal(v[name]));

function isFileSummary(v: unknown): v is FileSummary {
  return (
    isRecord(v) &&
    STATUSES.has(v["status"] as string) &&
    (v["broker"] === null || isBroker(v["broker"])) &&
    isDateOrNull(v["firstDate"]) &&
    isDateOrNull(v["lastDate"]) &&
    isCount(v["rows"]) &&
    (v["sameAs"] === null || isCount(v["sameAs"])) &&
    typeof v["unnamedAccount"] === "boolean" &&
    isArrayOf(v["findings"], isFinding)
  );
}

function isPayerPrompt(v: unknown): v is PayerPrompt {
  return (
    isRecord(v) &&
    isAnIsin(v["isin"]) &&
    isString(v["symbol"]) &&
    isString(v["name"]) &&
    isString(v["isinCountry"]) &&
    isString(v["broker"]) &&
    isCount(v["payments"])
  );
}

function isForm(v: unknown): v is FormOutput {
  return (
    isRecord(v) &&
    isStringOrNull(v["xml"]) &&
    isCount(v["blocking"]) &&
    typeof v["needed"] === "boolean"
  );
}

/** Tickers by ISIN: every key an ISIN, every value text. */
const isSymbols = (v: unknown): v is Record<string, string> =>
  isRecord(v) &&
  Object.entries(v).every(([isin, symbol]) => isIsin(isin) && isString(symbol));

const isMoney = (v: unknown): v is Money =>
  isRecord(v) && isDecimal(v["amount"]) && isString(v["currency"]);

const RATE_SOURCES = new Set(["bsi-daily", "bsi-monthly", "euro-changeover"]);

const isRate = (v: unknown): v is RateProvenance | null =>
  v === null ||
  (isRecord(v) &&
    isString(v["currency"]) &&
    isDecimal(v["rate"]) &&
    isDate(v["listDate"]) &&
    RATE_SOURCES.has(v["source"] as string));

const isSource = (v: unknown): boolean =>
  isRecord(v) && isString(v["file"]) && isCount(v["row"]) && isPart(v["part"]);

const isBucket = (v: unknown): boolean =>
  (HOLDING_BUCKETS as readonly unknown[]).includes(v);

const isBuckets = (v: unknown): boolean =>
  isRecord(v) && HOLDING_BUCKETS.every((bucket) => isDecimal(v[bucket]));

function isKdvpRow(v: unknown): v is KdvpRow {
  if (!isRecord(v)) return false;
  const split = v["splitAdjusted"];
  return (
    (v["kind"] === "purchase" || v["kind"] === "sale") &&
    isDate(v["date"]) &&
    decimals(v, "quantity", "priceEur") &&
    isMoney(v["price"]) &&
    isRate(v["rate"]) &&
    isBroker(v["broker"]) &&
    isSource(v["source"]) &&
    (split === undefined ||
      (isRecord(split) && isString(split["ratio"]) && isDate(split["date"])))
  );
}

const isLot = (v: unknown): v is MatchedLot =>
  isRecord(v) &&
  isDate(v["purchaseDate"]) &&
  isDate(v["saleDate"]) &&
  decimals(
    v,
    "quantity",
    "acquisitionEur",
    "disposalEur",
    "gainEur",
    "normedCostsEur",
  ) &&
  isCount(v["yearsHeld"]) &&
  isBucket(v["bucket"]);

const isSecurity = (v: unknown): v is SecurityResult =>
  isRecord(v) &&
  isAnIsin(v["isin"]) &&
  isString(v["symbol"]) &&
  isString(v["name"]) &&
  isArrayOf(v["brokers"], isBroker) &&
  isArrayOf(v["rows"], isKdvpRow) &&
  isArrayOf(v["lots"], isLot) &&
  decimals(v, "quantitySold", "proceedsEur", "costEur", "gainEur");

const isDividend = (v: unknown): v is DividendRow =>
  isRecord(v) &&
  isDate(v["date"]) &&
  isString(v["symbol"]) &&
  isString(v["payer"]) &&
  isAnIsin(v["isin"]) &&
  isString(v["country"]) &&
  isMoney(v["gross"]) &&
  isMoney(v["foreignTax"]) &&
  isRate(v["rate"]) &&
  decimals(v, "grossEur", "foreignTaxEur", "creditEur") &&
  (v["treatyRate"] === null || isDecimal(v["treatyRate"])) &&
  isBroker(v["broker"]) &&
  isSource(v["source"]);

const isImportedFile = (v: unknown): v is ImportedFile =>
  isRecord(v) &&
  isString(v["name"]) &&
  isBroker(v["broker"]) &&
  isDate(v["firstDate"]) &&
  isDate(v["lastDate"]) &&
  isCount(v["rowsRead"]);

const isMonth = (v: unknown): v is MonthlyAmount =>
  isRecord(v) &&
  isString(v["month"]) &&
  MONTH.test(v["month"]) &&
  isDecimal(v["grossEur"]);

/** The review, every field its screens read. */
function isPreview(v: unknown): v is ReturnPreview {
  if (!isRecord(v)) return false;
  const totals = v["gainsTotals"];
  const gains = v["gainsEstimate"];
  const dividends = v["dividendsEstimate"];
  return (
    isCount(v["taxYear"]) &&
    isArrayOf(v["files"], isImportedFile) &&
    isArrayOf(v["securities"], isSecurity) &&
    isArrayOf(v["dividends"], isDividend) &&
    isArrayOf(v["findings"], isFinding) &&
    isCount(v["omittedFindings"]) &&
    isSymbols(v["symbols"]) &&
    isRecord(totals) &&
    decimals(totals, "proceedsEur", "costEur", "gainEur") &&
    isRecord(gains) &&
    isBuckets(gains["positiveByBucket"]) &&
    isBuckets(gains["allocatedByBucket"]) &&
    decimals(gains, "lossesEur", "netBaseEur", "taxEur") &&
    isRecord(dividends) &&
    decimals(
      dividends,
      "taxRate",
      "grossEur",
      "foreignTaxEur",
      "creditEur",
      "taxDueEur",
    ) &&
    isArrayOf(v["dividendsByMonth"], isMonth)
  );
}

/** A reply the page may use: this version, a known kind, the right shape. */
export function isReply(v: unknown): v is EngineReply {
  if (!isRecord(v) || v["v"] !== PROTOCOL_VERSION || !isCount(v["id"])) {
    return false;
  }
  switch (v["kind"]) {
    case "failed":
      return true;
    case "read":
      return (
        isArrayOf(v["files"], isFileSummary) &&
        isArrayOf(v["findings"], isFinding) &&
        isCount(v["omittedFindings"]) &&
        isArrayOf(v["payers"], isPayerPrompt) &&
        isSymbols(v["symbols"])
      );
    case "prepare":
      return (
        isArrayOf(v["files"], isFileSummary) &&
        isPreview(v["preview"]) &&
        isForm(v["kdvp"]) &&
        isForm(v["div"])
      );
    default:
      return false;
  }
}

const ACCOUNTS = new Set(["same", "separate"]);
const TAXPAYER_FIELDS = [
  "taxNumber",
  "name",
  "address",
  "postCode",
  "city",
  "email",
] as const;
const PAYER_FIELDS = [
  "isin",
  "name",
  "address",
  "country",
  "id",
  "sourceCountry",
] as const;

const isRequestFile = (v: unknown): v is RequestFile =>
  isRecord(v) && isString(v["name"]) && v["bytes"] instanceof ArrayBuffer;

/** A request the worker may act on. */
export function isRequest(v: unknown): v is EngineRequest {
  if (
    !isRecord(v) ||
    v["v"] !== PROTOCOL_VERSION ||
    !isCount(v["id"]) ||
    !isArrayOf(v["files"], isRequestFile) ||
    !ACCOUNTS.has(v["accounts"] as string) ||
    !isCount(v["taxYear"])
  ) {
    return false;
  }
  if (v["kind"] === "read") return true;
  if (v["kind"] !== "prepare") return false;
  const { taxpayer, payers } = v;
  return (
    isRecord(taxpayer) &&
    TAXPAYER_FIELDS.every((field) => isString(taxpayer[field])) &&
    isArrayOf(
      payers,
      (p): p is PayerDetails =>
        isRecord(p) && PAYER_FIELDS.every((field) => isString(p[field])),
    )
  );
}
