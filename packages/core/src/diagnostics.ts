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
  | "No. of shares"
  | "Price / share"
  | "Withholding tax"
  | "Total"
  | "quantity"
  | "tradePrice"
  | "tradeMoney"
  | "multiplier"
  | "amount"
  | "ibCommission"
  | "shares"
  | "price"
  | "fee";

/** Why a CSV export could not be read (packages/brokers/src/csv.ts). */
export type CsvReason =
  | "tooLarge"
  | "tooManyRows"
  | "tooManyColumns"
  | "cellTooLong"
  | "unterminatedQuote"
  | "strayQuote"
  | "strayCarriageReturn"
  | "noHeader"
  | "emptyHeaderName"
  | "duplicateHeaderName"
  | "rowLength";

/** Why an XML export could not be read (packages/brokers/src/xml.ts). */
export type XmlReason =
  | "declaration"
  | "doctype"
  | "processingInstruction"
  | "cdata"
  | "comment"
  | "entity"
  | "characterReference"
  | "illegalCharacter"
  | "name"
  | "namespace"
  | "duplicateAttribute"
  | "attributeSyntax"
  | "tooManyAttributes"
  | "valueTooLong"
  | "lessThanInValue"
  | "text"
  | "cdataEnd"
  | "mismatchedEnd"
  | "tooDeep"
  | "tooManyElements"
  | "afterRoot"
  | "noRoot"
  | "truncated";

/** Why a ZIP archive could not be read (packages/brokers/src/zip.ts). */
export type ZipReason =
  /** No End of Central Directory record ends the file, or more than one could. */
  | "zipEnd"
  /** A ZIP64 record, field or extra field. */
  | "zip64"
  /** An archive spanning more than one disk. */
  | "zipDisk"
  /** More entries than LIMITS.zipEntries. */
  | "zipEntries"
  /** A central directory that is not where, or what, the end record says. */
  | "zipDirectory"
  /** A local header missing, or disagreeing with its central entry. */
  | "zipHeader"
  /** Entries that leave a gap, overlap, or do not start the file. */
  | "zipLayout"
  /** An encrypted entry. */
  | "zipEncrypted"
  /** A general-purpose flag the reader does not take. */
  | "zipFlags"
  /** A compression method other than stored or DEFLATE. */
  | "zipMethod"
  /** An entry name outside the reader's rules. */
  | "zipName"
  /** Two entries whose names differ only in case, or not at all. */
  | "zipDuplicate"
  /** An extra field too long or malformed. */
  | "zipExtra"
  /** Parts to read whose declared sizes exceed LIMITS.inflatedBytes. */
  | "zipBudget"
  /** A stored entry whose compressed size is not its size. */
  | "zipStoredSize"
  /** A DEFLATE stream the decoder refuses. */
  | "zipInflate"
  /** Content whose CRC-32 is not the one declared. */
  | "zipChecksum"
  /** A data descriptor disagreeing with the central entry. */
  | "zipDescriptor";

/** Why an XLSX workbook could not be read (packages/brokers/src/xlsx.ts). */
export type XlsxReason =
  /**
   * The package is not laid out as OPC requires: a relationship or content
   * type missing or malformed, a target that names no part, two sheets in
   * one part.
   */
  | "xlsxPackage"
  /** A part that is not UTF-8. */
  | "xlsxEncoding"
  /** A sheet or the shared strings kept outside the file. */
  | "xlsxExternal"
  /** The workbook's list of sheets, or its date system, malformed. */
  | "xlsxWorkbook"
  /** More sheets than LIMITS.sheetsPerFile. */
  | "xlsxSheets"
  /** A sheet name blank, longer than 31 characters, or repeated. */
  | "xlsxSheetName"
  /** An element, or text, where a sheet or the shared strings hold none. */
  | "xlsxStructure"
  /** A row or cell reference malformed, out of order, repeated or past XFD1048576. */
  | "xlsxReference"
  /** A column past LIMITS.columns. */
  | "xlsxColumns"
  /** More rows than LIMITS.recordsPerFile in the sheets read. */
  | "xlsxRows"
  /** More cells than LIMITS.cellsPerFile in the sheets read. */
  | "xlsxCells"
  /** A shared-string index not canonical or out of range, or too many strings. */
  | "xlsxSharedStrings"
  /** A string too long, the cells' text too long together, or an escape naming no character. */
  | "xlsxText"
  /** A kind of cell the reader does not read (a date cell, cell metadata, an unknown type). */
  | "xlsxCellType"
  /** A number cell whose value is no number, or lies out of range. */
  | "xlsxNumber"
  /** A formula in a sheet an adapter reads. */
  | "xlsxFormula";

/** A closed list, so that no text from a file can pass for a reason. */
export type UnreadableReason = CsvReason | XmlReason | ZipReason | XlsxReason;

/** A security and a day, when both have their proper shape. */
interface Where {
  readonly isin: string;
  readonly date: IsoDate;
}

/** For refusals: only the parts that had their proper shape. */
type MaybeWhere = Partial<Where>;

/**
 * What a refused row does to a holding, where its adapter can tell (ADR
 * 0017): gives shares up (a sale at a price of 0), receives shares (the new
 * shares of a takeover paid in shares), or receives rights. With it, an ISIN
 * and a date, a refusal withholds only the returns it can change; without
 * any of the three, both returns of every year. Setting it is an adapter's
 * claim about what the row can reach, made only for a shape whose reach has
 * been analysed as ADR 0017 asks: never a default.
 */
export type RefusedShares = "out" | "in" | "rights";

/** A refused row's security, date and effect, as far as they are known. */
type Reach = MaybeWhere & { readonly shares?: RefusedShares };

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
  | "notUtf8"
  /** A macro-enabled workbook (.xlsm), or one carrying a VBA project or macro sheet. */
  | "macroWorkbook"
  /** A binary workbook (.xlsb). */
  | "binaryWorkbook"
  /** A Strict Open XML workbook, which Excel writes only on request. */
  | "strictWorkbook";

/** Each code and the parameters it carries. */
export interface DiagnosticParams {
  // The ledger (core)
  tooManyEvents: { readonly limit: number };
  /**
   * The files together are larger than one session reads
   * (LIMITS.sessionBytes, in MiB): the rest are not read, so no return is.
   */
  sessionTooLarge: { readonly mebibytes: number };
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
  /** The ratio a broker gave disagrees with the share change it reported. */
  splitPositionMismatch: Where & {
    readonly expected: string;
    readonly reported: string;
  };
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
  /**
   * A refused row that can change neither return of `year`, shown in place
   * of its refusal (ADR 0017); it still withholds the returns it can
   * change. Worded from what the row does to the holding, never from file
   * text.
   */
  refusedElsewhere: Where & {
    readonly year: string;
    readonly shares: RefusedShares;
  };
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
  /** `row` is the CSV row, or the XML line, the reader stopped at. */
  /**
   * Where it stopped: a CSV row or an XML line, 0 for none; in a workbook,
   * the sheet's position and the cell's row and column, each from 1.
   */
  unreadableFile: {
    readonly reason: UnreadableReason;
    readonly row: number;
    readonly sheet?: number;
    readonly column?: number;
  };
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
  unsupportedAction: {
    readonly broker: string;
    readonly action: string;
  } & Reach;
  /**
   * Rows whose treatment is settled but whose columns' meaning in this
   * export no source confirms yet; `action` from the adapter's own list.
   */
  unconfirmedAction: { readonly broker: string; readonly action: string };
  invalidTime: None;
  dateMovedToLjubljana: { readonly date: IsoDate; readonly utcDate: IsoDate };
  invalidIsin: None;
  invalidNumber: { readonly column: NumberColumn };
  invalidQuantity: None;
  invalidCurrency: None;
  invalidPrice: Reach;
  unexpectedSign: { readonly column: NumberColumn };
  dividendTaxCurrency: None;
  splitUnpaired: Isin;
  splitRatioUnclear: Where;
  splitHalvesDisagree: Where;
  interestNotCovered: { readonly broker: string; readonly count: number };
  derivativesNotCovered: { readonly broker: string; readonly count: number };
  // Interactive Brokers Flex statements (brokers)
  statementCountMismatch: {
    readonly declared: number;
    readonly found: number;
  };
  accountMismatch: None;
  accountIdInvalid: None;
  paperAccount: None;
  tooManyAccounts: { readonly limit: number };
  unsupportedDateFormat: None;
  statementPeriodInvalid: None;
  rowAfterStatement: MaybeWhere;
  unknownElement: { readonly element: UntrustedText };
  unknownDetailLevel: { readonly level: UntrustedText };
  summaryOnly: {
    readonly section: "Trades" | "CashTransactions" | "CorporateActions";
  };
  withholdingUnlinked: MaybeWhere;
  withholdingAmbiguous: MaybeWhere;
  dividendReversalUnmatched: MaybeWhere;
  tradeInconsistent: MaybeWhere & {
    readonly check: "sign" | "multiplier" | "amount" | "cusip";
  };
  fundFromName: Isin;
  /**
   * A dividend the broker labels otherwise ("Bonus", "Demerger"), counted as
   * an ordinary dividend; `label` comes from the adapter's own list.
   */
  dividendLabelTreated: {
    readonly broker: string;
    readonly label: "bonus" | "demerger";
  };
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
