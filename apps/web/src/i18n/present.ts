/**
 * A finding as a sentence: its parameters shown for the locale (dates,
 * amounts, a security as its ticker and ISIN, a file by the name the user
 * gave it, a closed list's value in words), then the catalog's sentence for
 * its code (i18n/findings.ts). Text from a file stays text: the sentence is
 * rendered as a React string, never as markup (ADR 0013 §10).
 */
import type { Finding, FindingParam } from "../model/preview";
import {
  findingsEn,
  findingsSl,
  wordsEn,
  wordsSl,
  type FindingMessages,
  type FindingWords,
} from "./findings";
import {
  formatCountry,
  formatDate,
  formatEur,
  formatNumber,
  formatPercent,
  formatRate,
  type Locale,
} from "./format";
import { isTicker, plainText } from "./text";

const CATALOGS: Readonly<
  Record<
    Locale,
    { readonly messages: FindingMessages; readonly words: FindingWords }
  >
> = {
  en: { messages: findingsEn, words: wordsEn },
  sl: { messages: findingsSl, words: wordsSl },
};

/** What the sentence needs besides the finding itself. */
export interface FindingContext {
  readonly locale: Locale;
  /** The name of the file at a position in the request. */
  readonly fileName: (file: number) => string;
  /** Tickers by ISIN, for "AAPL (US0378331005)". */
  readonly symbols: Readonly<Record<string, string>>;
}

const DATES = new Set([
  "date",
  "until",
  "purchased",
  "dividendDate",
  "from",
  "to",
  "utcDate",
]);
const EUROS = new Set(["withheldEur", "creditEur", "excessEur"]);
const QUANTITIES = new Set([
  "quantity",
  "missing",
  "replaced",
  "expected",
  "reported",
]);
const COUNTS = new Set([
  "count",
  "limit",
  "dropped",
  "declared",
  "found",
  "position",
]);

const PLAIN_DECIMAL = /^-?\d{1,40}(\.\d{1,40})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A column of a sheet by number, as Excel names it: 1 is A, 27 is AA,
 * 16,384 is XFD. Anything that is not a column (zero, a fraction) stays a
 * number.
 */
export function columnName(column: number): string {
  if (!Number.isSafeInteger(column) || column < 1) return String(column);
  let name = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(0x41 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** A closed list's value in words, or the value itself if the list lacks it. */
function word(list: Readonly<Record<string, string>>, value: string): string {
  return Object.hasOwn(list, value) ? (list[value] as string) : value;
}

/** Why a file was refused or unreadable, or why a rate is missing. */
function reason(code: Finding["code"], value: string, words: FindingWords) {
  switch (code) {
    case "fileRefused":
      return word(words.refusals, value);
    case "unreadableFile":
      return word(words.unreadable, value);
    case "rateUnavailable":
      return word(words.rateErrors, value);
    default:
      return value;
  }
}

function shown(
  name: string,
  value: FindingParam,
  finding: Finding,
  context: FindingContext,
  words: FindingWords,
): string {
  const { locale } = context;
  if (typeof value === "object") {
    return "file" in value
      ? context.fileName(value.file)
      : plainText(value.untrusted);
  }
  if (typeof value === "number") {
    // A sheet's column is named as Excel names it, by letters.
    if (name === "column") return columnName(value);
    // A row, line or sheet number is an identifier: its digits are never
    // grouped.
    return name === "row" || name === "sheet"
      ? String(value)
      : formatNumber(String(value), locale);
  }
  if (name === "isin") {
    const symbol = Object.hasOwn(context.symbols, value)
      ? plainText(context.symbols[value] ?? "")
      : "";
    return isTicker(symbol) ? `${symbol} (${value})` : value;
  }
  if (DATES.has(name) && ISO_DATE.test(value)) return formatDate(value, locale);
  if (!PLAIN_DECIMAL.test(value)) {
    switch (name) {
      case "kind":
        return word(words.kinds, value);
      case "reason":
        return reason(finding.code, value, words);
      case "broker":
        return word(words.brokers, value);
      case "action": {
        // "corporateAction FI": the adapter's word, then the export's code.
        const space = value.indexOf(" ");
        return space === -1
          ? word(words.actions, value)
          : `${word(words.actions, value.slice(0, space))}${value.slice(space)}`;
      }
      case "section":
        return word(words.sections, value);
      case "check":
        return word(words.tradeChecks, value);
      case "country":
        // FURS writes Greece as EL; the display names know it as GR.
        return formatCountry(value === "EL" ? "GR" : value, locale);
      default:
        return value;
    }
  }
  if (EUROS.has(name)) return formatEur(value, locale);
  if (name === "treatyRate") return formatPercent(value, locale);
  if (name === "bsi" || name === "ecb") return formatRate(value, locale);
  if (QUANTITIES.has(name)) {
    return formatNumber(value, locale, { maxFraction: 10 });
  }
  if (COUNTS.has(name)) return formatNumber(value, locale);
  return value;
}

/** The finding as a sentence in the locale's language. */
export function findingText(finding: Finding, context: FindingContext): string {
  const { messages, words } = CATALOGS[context.locale];
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(finding.params)) {
    params[name] = shown(name, value, finding, context, words);
  }
  // The engine typed each code's parameters when it raised the finding, and
  // the client let through only codes the catalog has (engine/protocol.ts):
  // here they are a plain record.
  const say = messages[finding.code] as (p: Record<string, string>) => string;
  return say(params);
}

/** Whether the catalog can say a code: anything else is no finding of ours. */
export function isFindingCode(code: string): code is Finding["code"] {
  return Object.hasOwn(findingsEn, code);
}
