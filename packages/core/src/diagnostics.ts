/**
 * Findings for the user, from any stage of the pipeline. The core emits a
 * stable code and raw parameters; the apps turn them into sentences in the
 * user's language. Parameters hold identifiers of securities, dates and
 * amounts, never personal data, so a diagnostic is safe to show and to log.
 */
import type { SourceRef } from "./ledger.js";

/** Blocking diagnostics stop the export; warnings and notes do not. */
export type Severity = "blocking" | "warning" | "info";

export interface Diagnostic {
  readonly severity: Severity;
  readonly code: string;
  readonly params: Readonly<Record<string, string>>;
  readonly source?: SourceRef;
}

export function diagnostic(
  severity: Severity,
  code: string,
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
