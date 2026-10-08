/**
 * @taxreporter/brokers — broker-export adapters (ADR 0004). Each turns one
 * export format into the ledger events of @taxreporter/core; the registry
 * picks the adapter by the file's content, never by its name. Trading 212
 * first, Interactive Brokers next.
 *
 * Platform-neutral like @taxreporter/core (browser app and CLI): no Node.js
 * built-ins, enforced by `make build` (tsconfig.build.json). Callers read the
 * file and pass its text.
 */
export const PACKAGE = "@taxreporter/brokers";

export {
  CSV_ADAPTERS,
  importFile,
  type CsvAdapter,
  type ImportResult,
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
export { fromUtcStamp, type UtcStamp } from "./time.js";
export {
  splitRatio,
  TRADING212,
  trading212,
  trading212Cfd,
} from "./trading212.js";
