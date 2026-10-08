/**
 * Findings for the user, from any stage of the pipeline. The core emits a
 * stable code and typed parameters; the apps turn them into sentences in the
 * user's language, from one message catalog keyed by `DiagnosticCode`
 * (ADR 0011).
 *
 * Every code has a parameter shape, and a code cannot exist without one.
 * Parameters are values of a checked shape: ISINs, ISO dates, decimals,
 * counts, currency codes, the adapters' own column names. Text copied from a
 * file travels only inside `UntrustedText`, which the screen may show and
 * every export drops. A diagnostic's `source` points into a file the user
 * chose; `forExport` drops it too, so what reaches a log, a bug report or
 * the LLM check holds nothing from the user's files (CLAUDE.md, "Privacy").
 */
import type { IsoDate } from "./dates.js";
import type { FileId, KeyedEvent, SourceRef } from "./ledger.js";

/** Blocking diagnostics stop the export; warnings and notes do not. */
export type Severity = "blocking" | "warning" | "info";

/**
 * Text copied from a file, for the user's screen only: a wrapper rather than
 * a string, so neither String() nor a template literal renders it by
 * accident. At most `UNTRUSTED_LENGTH` characters.
 */
export interface UntrustedText {
  readonly untrusted: string;
}

export const UNTRUSTED_LENGTH = 80;

/** Wraps file text for a diagnostic, cut to `UNTRUSTED_LENGTH` characters. */
export function untrusted(text: string): UntrustedText {
  let end = 0;
  for (let n = 0; n < UNTRUSTED_LENGTH && end < text.length; n += 1) {
    const unit = text.charCodeAt(end);
    end += unit >= 0xd800 && unit <= 0xdbff ? 2 : 1;
  }
  return Object.freeze({ untrusted: text.slice(0, end) });
}

/**
 * A file a finding is about besides its source, named by the screen with the
 * name the user gave it. Every export drops it, as it drops the source: a
 * file's ID is the same in every session, and would link two reports.
 */
export interface FileRef {
  readonly file: FileId;
}

export function fileRef(fileId: FileId): FileRef {
  return Object.freeze({ file: fileId });
}

export const isFileRef = (value: unknown): value is FileRef =>
  typeof value === "object" && value !== null && "file" in value;

/**
 * The numbers a finding may name by column: the adapters' own names for
 * them, never a header as a file wrote it.
 */
export type NumberColumn =
  "No. of shares" | "Price / share" | "Withholding tax" | "Total";

/** A security and a day, when both have their proper shape. */
interface Where {
  readonly isin: string;
  readonly date: IsoDate;
}

/** For refusals: only the parts that had their proper shape. */
type MaybeWhere = Partial<Where>;

type Isin = Pick<Where, "isin">;
type None = Readonly<Record<string, never>>;

/**
 * Two files of one account and the days both recorded. The file IDs are
 * hashes of the files' bytes, which the screen turns back into the names
 * the user chose.
 */
interface Overlap {
  readonly kind: KeyedEvent["kind"];
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly first: FileRef;
  readonly second: FileRef;
}

/**
 * Why intake refused a file before any adapter read it: too large, a
 * format that is no text export whatever its name says, or not UTF-8.
 */
export type FileRefusal =
  | "tooLarge"
  | "zip"
  | "spreadsheet"
  | "pdf"
  | "gzip"
  | "utf16"
  | "utf32"
  | "binary"
  | "notUtf8";

/** Each code and the parameters it carries. */
export interface DiagnosticParams {
  // The ledger (core)
  tooManyEvents: { readonly limit: number };
  unknownEvent: None;
  invalidTrade: MaybeWhere;
  invalidSplit: MaybeWhere;
  invalidDividend: MaybeWhere;
  invalidWithholding: MaybeWhere;
  duplicatesRemoved: { readonly count: number };
  duplicateKeyInFile: MaybeWhere;
  duplicateKeyConflict: MaybeWhere;
  overlapMismatch: Overlap;
  overlapKindMissing: Overlap;
  /** One file of each account where the first shared event was read. */
  accountsShareEvents: {
    readonly kind: "trade" | "dividend";
    readonly count: number;
    readonly first: FileRef;
    readonly second: FileRef;
  };
  /** Two different files whose IDs are the same: neither is read. */
  fileIdClash: { readonly file: FileRef };
  // The FIFO engine (core)
  splitReportsMerged: Where;
  splitConflict: Where;
  splitDateAmbiguous: Where & { readonly until: IsoDate };
  tooManySplits: Isin;
  sameDayLotOrder: Where & { readonly purchased: IsoDate };
  zeroCostPurchase: Where;
  insufficientHistory: Where & { readonly missing: string };
  // The Doh-KDVP builder (furs)
  rateUnavailable: {
    readonly currency: string;
    readonly date: IsoDate;
    readonly reason: string;
  };
  rateDiffersFromEcb: {
    readonly currency: string;
    readonly date: IsoDate;
    readonly bsi: string;
    readonly ecb: string;
  };
  exemptLotsLeftOut: Isin & { readonly quantity: string };
  lossCounts: Where;
  lossDisallowed: Where;
  lossPartlyDisallowed: Where & { readonly replaced: string };
  washSaleWindowOpen: Where & { readonly until: IsoDate };
  splitAdjusted: Where & { readonly ratio: string };
  quantitiesRounded: Isin;
  quantityTooSmall: Where;
  formIssue: { readonly code: string; readonly path: string };
  // The Doh-Div builder (furs)
  withholdingWithoutDividend: Where;
  withholdingIsinMismatch: Where;
  withholdingForOtherYear: Where & { readonly dividendDate: IsoDate };
  dividendNotPositive: Where;
  foreignTaxNegative: Where;
  payerUnknown: Isin;
  sourceCountryUnknown: Isin;
  slovenianPayer: Where;
  payerIdIsIsin: Isin;
  treatyRateUnknown: { readonly country: string };
  excessWithholding: Where & {
    readonly country: string;
    readonly withheldEur: string;
    readonly treatyRate: string;
    readonly creditEur: string;
    readonly excessEur: string;
  };
  payerIdsNumbered: { readonly date: IsoDate; readonly count: number };
  // Intake and broker adapters (brokers)
  fileRefused: { readonly reason: FileRefusal };
  unreadableFile: { readonly reason: string; readonly row: number };
  diagnosticsTruncated: { readonly dropped: number };
  unknownFormat: None;
  ambiguousFormat: None;
  derivativesNotSupported: { readonly broker: string };
  unknownColumn: {
    readonly broker: string;
    readonly position: number;
    readonly column: UntrustedText;
  };
  unknownAction: { readonly broker: string; readonly action: UntrustedText };
  /** `action` comes from the adapter's own closed list, never the file. */
  unsupportedAction: { readonly broker: string; readonly action: string };
  invalidTime: None;
  dateMovedToLjubljana: { readonly date: IsoDate; readonly utcDate: IsoDate };
  invalidIsin: None;
  invalidNumber: { readonly column: NumberColumn };
  invalidQuantity: None;
  invalidCurrency: None;
  invalidPrice: None;
  unexpectedSign: { readonly column: NumberColumn };
  dividendTaxCurrency: None;
  splitUnpaired: Isin;
  splitRatioUnclear: Where;
  splitHalvesDisagree: Where;
  interestNotCovered: { readonly broker: string; readonly count: number };
  fundFromName: Isin;
}

/**
 * Every code any stage emits, so that the message catalog can be checked
 * for completeness and a renamed code fails to compile.
 */
export type DiagnosticCode = keyof DiagnosticParams;

export type Diagnostic = {
  [C in DiagnosticCode]: {
    readonly severity: Severity;
    readonly code: C;
    readonly params: Readonly<DiagnosticParams[C]>;
    readonly source?: SourceRef;
  };
}[DiagnosticCode];

export function diagnostic<C extends DiagnosticCode>(
  severity: Severity,
  code: C,
  params: DiagnosticParams[C],
  source?: SourceRef,
): Diagnostic {
  const base = { severity, code, params };
  return (source === undefined ? base : { ...base, source }) as Diagnostic;
}

export function hasBlocking(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "blocking");
}

/** A parameter value as it may leave the user's screen. */
export type ExportedValue = string | number;

/** A diagnostic stripped for a log, a bug report or the LLM check. */
export interface ExportedDiagnostic {
  readonly severity: Severity;
  readonly code: DiagnosticCode;
  readonly params: Readonly<Record<string, ExportedValue>>;
}

const isUntrusted = (value: unknown): value is UntrustedText =>
  typeof value === "object" && value !== null && "untrusted" in value;

/**
 * The diagnostic without its source, the files it names, or any text copied
 * from a file: the only form that may leave the user's screen.
 */
export function forExport(d: Diagnostic): ExportedDiagnostic {
  const params: Record<string, ExportedValue> = {};
  for (const [key, value] of Object.entries(d.params) as [string, unknown][]) {
    if (typeof value === "string" || typeof value === "number") {
      params[key] = value;
    } else if (!isUntrusted(value) && !isFileRef(value)) {
      throw new TypeError("A diagnostic parameter of an unexpected type");
    }
  }
  return { severity: d.severity, code: d.code, params };
}
