/**
 * @taxreporter/fx — Banka Slovenije reference rates: the snapshot the app
 * ships (built from BSI's history files) and the lookup that picks the rate
 * for a given currency and day, with its provenance.
 *
 * Platform-neutral like @taxreporter/core (browser app and CLI): no Node.js
 * built-ins, enforced by `make build` (tsconfig.build.json). The snapshot
 * files are passed in as text; each app loads them its own way.
 */
export const PACKAGE = "@taxreporter/fx";

export {
  MAX_SOURCE_LENGTH,
  parseDailyXml,
  parseMonthlyXml,
  type PublishedList,
} from "./bsi-xml.js";
export {
  EURO_CHANGEOVERS,
  KNOWN_DISCREPANCIES,
  MAX_LOOKBACK_DAYS,
  MINOR_UNITS,
  RateTable,
  toEur,
  type BsiRate,
  type RateError,
  type RateResult,
  type RateSource,
} from "./rates.js";
export {
  dailyCsv,
  isIsoDate,
  monthlyCsv,
  parseSnapshotCsv,
  type SnapshotTable,
} from "./snapshot.js";
