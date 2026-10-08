/**
 * Every bound on what an import may hold, in one place (ADR 0011). Every
 * imported file is hostile (CLAUDE.md, "Secure code"), so each of these is
 * checked where the input arrives, and tested at its value and one past it.
 * They sit far above any real export: a heavy Trading 212 year is a few
 * thousand rows, an active IBKR statement a few tens of thousands.
 */
export const LIMITS = Object.freeze({
  /** Bytes in one file, checked before it is read. */
  fileBytes: 64 * 1024 * 1024,
  /** Files in one session: ten years of two brokers' yearly exports, and more. */
  filesPerSession: 100,
  /** Rows or records in one file; refused beyond, never truncated. */
  recordsPerFile: 200_000,
  /** Ledger events across a session. */
  eventsPerSession: 500_000,
  /** Columns in one CSV header. */
  columns: 128,
  /** Characters in one CSV cell or XML attribute value. */
  cellLength: 4096,
  /** Whole-number terms of a split ratio: real splits run to 1 for 1,000. */
  splitTerm: 10_000,
  /** Splits on one security over its whole history. */
  splitsPerSecurity: 32,
  /** Brokers' reports of one split the engine expects at most. */
  splitReporters: 4,
  /** Findings for one file, then one saying how many more there were. */
  diagnosticsPerFile: 1000,
  /** Nesting depth of an XML export. */
  xmlDepth: 16,
  /** Attributes on one XML element. */
  xmlAttributes: 256,
  /** Whole digits and decimals of a number a broker writes. */
  numberWholeDigits: 15,
  numberDecimals: 12,
});
