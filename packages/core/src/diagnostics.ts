/**
 * Findings for the user, from any stage of the pipeline. The core emits a
 * stable code and raw parameters; the apps turn them into sentences in the
 * user's language, from one message catalog keyed by `DiagnosticCode`.
 *
 * Parameters hold only values of a checked shape (ISINs, ISO dates,
 * decimals, counts, currency codes and the adapters' own column names),
 * never text copied from a file. A diagnostic's `source`, though, names a
 * file the user chose, and a file's name can carry an account number or a
 * client's name: a diagnostic with a source is for the user's screen only,
 * never for a log, a bug report or the LLM check (CLAUDE.md, "Privacy").
 */
import type { SourceRef } from "./ledger.js";

/** Blocking diagnostics stop the export; warnings and notes do not. */
export type Severity = "blocking" | "warning" | "info";

/**
 * Every code any stage emits, so that the message catalog can be checked
 * for completeness and a renamed code fails to compile.
 */
export type DiagnosticCode =
  // The ledger and the FIFO engine (core)
  | "unknownEvent"
  | "invalidTrade"
  | "invalidSplit"
  | "duplicatesRemoved"
  | "duplicateKeyInFile"
  | "duplicateKeyConflict"
  | "splitReportsMerged"
  | "splitConflict"
  | "splitDateAmbiguous"
  | "tooManySplits"
  | "sameDayLotOrder"
  | "zeroCostPurchase"
  | "insufficientHistory"
  // The Doh-KDVP builder (furs)
  | "rateUnavailable"
  | "rateDiffersFromEcb"
  | "exemptLotsLeftOut"
  | "lossCounts"
  | "lossDisallowed"
  | "lossPartlyDisallowed"
  | "washSaleWindowOpen"
  | "splitAdjusted"
  | "quantitiesRounded"
  | "quantityTooSmall"
  | "formIssue";

export interface Diagnostic {
  readonly severity: Severity;
  readonly code: DiagnosticCode;
  readonly params: Readonly<Record<string, string>>;
  readonly source?: SourceRef;
}

export function diagnostic(
  severity: Severity,
  code: DiagnosticCode,
  params: Readonly<Record<string, string>> = {},
  source?: SourceRef,
): Diagnostic {
  return source === undefined
    ? { severity, code, params }
    : { severity, code, params, source };
}

export function hasBlocking(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "blocking");
}
