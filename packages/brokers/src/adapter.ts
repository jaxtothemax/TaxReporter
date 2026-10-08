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
import { decodeUtf8, sniff } from "./intake.js";
import { trading212, trading212Cfd } from "./trading212.js";

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

const BLANK = new Set([" ", "\t", "\r", "\n", "﻿"]);

/** Whether the text's first character past any blank is `<`: XML. */
function looksLikeXml(text: string): boolean {
  for (const c of text) {
    if (c === "<") return true;
    if (!BLANK.has(c)) return false;
  }
  return false;
}

/**
 * Reads one export: the byte cap, the sniff, strict UTF-8, the family by
 * content, then exactly one adapter of that family. A file none recognizes,
 * or more than one does, is refused with a blocking diagnostic, never read
 * on a guess. The caller gives the file's ID (`fileIdOf` its bytes) and
 * keeps its name for the screen.
 */
export function importFile(request: ImportRequest): ImportResult {
  const { bytes, fileId, accountGroup } = request;
  const refusal = sniff(bytes);
  if (refusal !== null) return refused("fileRefused", { reason: refusal });
  const text = decodeUtf8(bytes);
  if (text === null) return refused("fileRefused", { reason: "notUtf8" });
  // No XML adapter yet: Interactive Brokers' Flex statements come next.
  if (looksLikeXml(text)) return refused("unknownFormat", {});
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
  return capped(adapter.read(table, { fileId, accountGroup }));
}
