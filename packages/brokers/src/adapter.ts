/**
 * What every broker adapter promises, and the registry that picks one for a
 * file (ADR 0004). An adapter recognizes its format by content, never by the
 * file's name, and turns every row into a ledger event, an explicit ignored
 * record, or a blocking diagnostic.
 */
import {
  diagnostic,
  LIMITS,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticParams,
  type IsoDate,
  type LedgerEvent,
} from "@taxreporter/core";

import { CsvError, readCsv, type CsvTable } from "./csv.js";
import { trading212, trading212Cfd } from "./trading212.js";

/** What an adapter makes of one file. */
export interface ImportResult {
  /** The broker the file came from, or "unknown". */
  readonly broker: string;
  /** The format and revision recognized, e.g. "trading212-csv-v4". */
  readonly format: string;
  readonly events: readonly LedgerEvent[];
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The latest date of any row, or null. The file covers at least this far,
   * which bounds what the 30-day rule can see after a loss.
   */
  readonly lastDate: IsoDate | null;
}

/** An adapter for a CSV export. */
export interface CsvAdapter {
  readonly broker: string;
  /** Recognizes the export by its header alone. */
  matches(header: readonly string[]): boolean;
  /** Reads a table `matches` took; `file` names it in every source. */
  read(table: CsvTable, file: string): ImportResult;
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

function refused<C extends DiagnosticCode>(
  code: C,
  params: DiagnosticParams[C],
) {
  return {
    broker: "unknown",
    format: "unknown",
    events: [],
    diagnostics: [diagnostic("blocking", code, params)],
    lastDate: null,
  } satisfies ImportResult;
}

/**
 * Reads one export. A file no adapter recognizes, or more than one does,
 * is refused with a blocking diagnostic, never read on a guess.
 */
export function importFile(file: string, text: string): ImportResult {
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
  const matching = CSV_ADAPTERS.filter((a) => a.matches(table.header));
  const [adapter] = matching;
  if (adapter === undefined) return refused("unknownFormat", {});
  if (matching.length > 1) return refused("ambiguousFormat", {});
  return capped(adapter.read(table, file));
}
