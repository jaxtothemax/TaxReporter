/**
 * @taxreporter/brokers — broker-export adapters (ADR 0004, ADR 0011). Each
 * turns one export format into the ledger events of @taxreporter/core;
 * `importFile` checks a file's bytes and picks the adapter by the file's
 * content, never by its name. Trading 212 first, Interactive Brokers next.
 *
 * Platform-neutral like @taxreporter/core (browser app and CLI): no Node.js
 * built-ins, enforced by `make build` (tsconfig.build.json). Callers read the
 * file and pass its bytes.
 */
export const PACKAGE = "@taxreporter/brokers";

export {
  CSV_ADAPTERS,
  importFile,
  MAX_DIAGNOSTICS_PER_FILE,
  type AccountReach,
  type CsvAdapter,
  type ImportRequest,
  type ImportResult,
  type ReadContext,
  type XlsxAdapter,
} from "./adapter.js";
export {
  CSV_LIMITS,
  CsvError,
  readCsv,
  type CsvErrorCode,
  type CsvLimits,
  type CsvRow,
  type CsvTable,
} from "./csv.js";
export { decodeUtf8, sniff } from "./intake.js";
export { fromUtcStamp } from "./time.js";
export {
  splitRatio,
  TRADING212,
  trading212,
  trading212Cfd,
} from "./trading212.js";
