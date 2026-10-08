/**
 * @taxreporter/core — the domain model: decimal money, the ledger, the FIFO lot
 * engine, the 30-day rule, the gains-tax and dividend-tax estimates and
 * diagnostics.
 *
 * This package is meant to run in the browser app as well as the CLI, so it
 * stays platform-neutral: no Node.js built-ins. `make build` compiles src/
 * against no Node.js types (tsconfig.build.json), so a stray `node:` import
 * fails the build.
 */
export const PACKAGE = "@taxreporter/core";

export { isIsoDate, type IsoDate } from "./dates.js";
export { Decimal, MAX_DECIMAL_LENGTH, type RoundingMode } from "./decimal.js";
export { isIsin } from "./isin.js";
export {
  diagnostic,
  hasBlocking,
  type Diagnostic,
  type DiagnosticCode,
  type Severity,
} from "./diagnostics.js";
export {
  DIVIDEND_TAX_RATE,
  dividendCredit,
  treatyDividendRate,
  type DividendCredit,
} from "./dividends.js";
export {
  estimateGainsTax,
  lotBase,
  type EstimateLot,
  type GainsEstimate,
  type LotBase,
} from "./estimate.js";
export {
  compareText,
  deduplicate,
  eventId,
  matchFifo,
  MAX_SPLIT_TERM,
  MAX_SPLITS,
  SPLIT_REPORT_DAYS,
  type Disposal,
  type FifoResult,
  type LotMatch,
  type OpenLot,
  type SecurityHistory,
} from "./fifo.js";
export {
  addDays,
  BUCKET_RATES,
  bucketFor,
  completedYears,
  daysBetween,
  HOLDING_BUCKETS,
  type HoldingBucket,
} from "./holding.js";
export type {
  DividendEvent,
  IgnoredReason,
  IgnoredRow,
  LedgerEvent,
  Money,
  SecurityRef,
  SourceRef,
  SplitEvent,
  TradeEvent,
  WithholdingEvent,
} from "./ledger.js";
export {
  WASH_SALE_DAYS,
  washSaleVerdicts,
  type LossSale,
  type WashSaleStatus,
  type WashSaleVerdict,
} from "./wash-sale.js";
