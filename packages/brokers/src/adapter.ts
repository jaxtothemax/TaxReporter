/**
 * What every broker adapter promises, and the one way into them (ADR 0004,
 * with the contract of ADR 0011). `importFile` takes a file's bytes, checks
 * them, and hands the text to the one adapter that recognizes it by content,
 * never by the file's name; the adapter turns every row into a ledger event,
 * an explicit ignored record, or a blocking diagnostic.
 */
import {
  diagnostic,
  LIMITS,
  type AccountScope,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type FileId,
  type IsoDate,
  type LedgerEvent,
} from "@taxreporter/core";

import { CsvError, readCsv, type CsvTable } from "./csv.js";
import { ibkr } from "./ibkr.js";
import { decodeUtf8, sniff } from "./intake.js";
import { trading212, trading212Cfd } from "./trading212.js";
import {
  openWorkbook,
  XlsxError,
  type Workbook,
  type WorkbookInfo,
} from "./xlsx.js";
import { peekRoot, XmlError, type XmlElement } from "./xml.js";

/** How far a file reaches for one account it covers. */
export interface AccountReach {
  readonly account: AccountScope;
  /**
   * The latest date of any of the account's rows, cash rows included: the
   * file covers at least this far, which bounds what the 30-day rule can
   * see after a loss.
   */
  readonly lastDate: IsoDate;
}

/** What an adapter makes of one file. */
export interface ImportResult {
  /** The broker the file came from, or "unknown". */
  readonly broker: string;
  /** The format and revision recognized, e.g. "trading212-csv-v4". */
  readonly format: string;
  readonly events: readonly LedgerEvent[];
  readonly diagnostics: readonly Diagnostic[];
  /** One entry per account with a dated row. */
  readonly reach: readonly AccountReach[];
}

/** What an adapter is told about the file it reads, and nothing more. */
export interface ReadContext {
  /** The file's ID, which every source reference names; never its name. */
  readonly fileId: FileId;
  /**
   * The group of accounts the user put the file in, from 1, for a broker
   * whose files do not name their account (ADR 0011: one account unless
   * the user says otherwise).
   */
  readonly accountGroup: number;
}

/** An adapter for a CSV export. */
export interface CsvAdapter {
  readonly broker: string;
  /** Recognizes the export by its header alone. */
  matches(header: readonly string[]): boolean;
  read(table: CsvTable, context: ReadContext): ImportResult;
}

/** An adapter for an XML export. */
export interface XmlAdapter {
  readonly broker: string;
  /** Recognizes the export by its root element alone. */
  matches(root: XmlElement): boolean;
  /** Scans the text itself; an XmlError it throws refuses the file. */
  read(text: string, context: ReadContext): ImportResult;
}

/**
 * An adapter for an XLSX workbook (ADR 0014 §6). It chooses by the sheet
 * list and date system alone, so choosing inflates nothing, and reads the
 * Workbook, never the file's bytes; an XlsxError it lets through, from a
 * sheet it asked for, refuses the file.
 */
export interface XlsxAdapter {
  readonly broker: string;
  matches(book: WorkbookInfo): boolean;
  read(book: Workbook, context: ReadContext): ImportResult;
}

/** One file to import. */
export interface ImportRequest extends ReadContext {
  readonly bytes: Uint8Array;
}

/**
 * At most this many findings per file, then one saying how many more there
 * were: a hostile file must not flood the review, and the summary blocks
 * whenever anything it stands for did.
 */
export const MAX_DIAGNOSTICS_PER_FILE = LIMITS.diagnosticsPerFile;

function capped(result: ImportResult): ImportResult {
  if (result.diagnostics.length <= MAX_DIAGNOSTICS_PER_FILE) return result;
  const dropped = result.diagnostics.slice(MAX_DIAGNOSTICS_PER_FILE);
  return {
    ...result,
    diagnostics: [
      ...result.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE),
      diagnostic(
        dropped.some((d) => d.severity === "blocking") ? "blocking" : "warning",
        "diagnosticsTruncated",
        { dropped: dropped.length },
      ),
    ],
  };
}

/** Every CSV adapter; a file must match exactly one of them. */
export const CSV_ADAPTERS: readonly CsvAdapter[] = Object.freeze([
  trading212,
  trading212Cfd,
]);

/** Every XML adapter; a file must match exactly one of them. */
export const XML_ADAPTERS: readonly XmlAdapter[] = Object.freeze([ibkr]);

/**
 * Every XLSX adapter; a workbook must match exactly one of them. None yet:
 * eToro's comes first (ADR 0014), and until then a workbook is read, and
 * not recognized.
 */
export const XLSX_ADAPTERS: readonly XlsxAdapter[] = Object.freeze([]);

function refused<C extends DiagnosticCode>(
  code: C,
  params: DiagnosticParams[C],
): ImportResult {
  return {
    broker: "unknown",
    format: "unknown",
    events: [],
    diagnostics: [diagnostic("blocking", code, params)],
    reach: [],
  };
}

const BLANK = new Set([" ", "\t", "\r", "\n", "\uFEFF"]);

/** Whether the text's first character past any blank is `<`: XML. */
function looksLikeXml(text: string): boolean {
  for (const c of text) {
    if (c === "<") return true;
    if (!BLANK.has(c)) return false;
  }
  return false;
}

/**
 * The one adapter of a family that recognizes the file, or the refusal: a
 * file none recognizes, or more than one does, is never read on a guess.
 * Every family chooses through here.
 */
function exactlyOne<T, A extends { matches(seen: T): boolean }>(
  adapters: readonly A[],
  seen: T,
): A | ImportResult {
  const matching = adapters.filter((a) => a.matches(seen));
  const [adapter] = matching;
  if (adapter === undefined) return refused("unknownFormat", {});
  if (matching.length > 1) return refused("ambiguousFormat", {});
  return adapter;
}

/** Whether `exactlyOne` came back with an adapter. */
const isAdapter = <A>(chosen: A | ImportResult): chosen is A =>
  !("events" in (chosen as object));

/** The XML family: the root picks the adapter, which reads the rest. */
function importXml(text: string, context: ReadContext): ImportResult {
  try {
    const adapter = exactlyOne(XML_ADAPTERS, peekRoot(text));
    if (!isAdapter(adapter)) return adapter;
    return capped(adapter.read(text, context));
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    return refused("unreadableFile", { reason: error.code, row: error.line });
  }
}

/**
 * The XLSX family (ADR 0014 §11): a ZIP opened as a workbook, its sheet
 * list picking the adapter, which asks for the sheets it reads. A ZIP that
 * is no workbook, or a workbook of a kind never read, is refused for what
 * it is; a damaged one names its rule and place.
 */
export function importXlsx(
  bytes: Uint8Array,
  context: ReadContext,
  adapters: readonly XlsxAdapter[] = XLSX_ADAPTERS,
): ImportResult {
  try {
    const book = openWorkbook(bytes);
    if (typeof book === "string") {
      return refused("fileRefused", { reason: book });
    }
    const adapter = exactlyOne(adapters, {
      sheets: book.sheets,
      date1904: book.date1904,
    });
    if (!isAdapter(adapter)) return adapter;
    return capped(adapter.read(book, context));
  } catch (error) {
    if (!(error instanceof XlsxError)) throw error;
    return refused("unreadableFile", {
      reason: error.code,
      row: error.row,
      ...(error.sheet === 0 ? {} : { sheet: error.sheet }),
      ...(error.column === 0 ? {} : { column: error.column }),
    });
  }
}

/**
 * Reads one export: the byte cap, the sniff, the family by content (XLSX
 * for a ZIP, else strict UTF-8 text, XML or CSV), then exactly one adapter
 * of that family. A file none recognizes, or more than one does, is
 * refused with a blocking diagnostic, never read on a guess. The caller
 * gives the file's ID (`fileIdOf` its bytes) and keeps its name for the
 * screen.
 */
export function importFile(request: ImportRequest): ImportResult {
  const { bytes, fileId, accountGroup } = request;
  const context = { fileId, accountGroup };
  const refusal = sniff(bytes);
  // A ZIP is the XLSX family's to open; the sniff still refuses it
  // wherever no workbook can be, as in the command line's payers file.
  if (refusal === "zip") return importXlsx(bytes, context);
  if (refusal !== null) return refused("fileRefused", { reason: refusal });
  const text = decodeUtf8(bytes);
  if (text === null) return refused("fileRefused", { reason: "notUtf8" });
  if (looksLikeXml(text)) return importXml(text, context);
  let table: CsvTable;
  try {
    table = readCsv(text);
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    return refused("unreadableFile", {
      reason: error.code,
      row: error.row,
    });
  }
  const adapter = exactlyOne(CSV_ADAPTERS, table.header);
  if (!isAdapter(adapter)) return adapter;
  return capped(adapter.read(table, context));
}
