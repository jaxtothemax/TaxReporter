/**
 * @taxreporter/pipeline — the one way from broker exports to returns: intake
 * of every file, the checked ledger, the coverage end, both builders, and
 * the holdings shown beside them.
 * The CLI and the web app both call it, so the same files give the same XML
 * in both (ADR 0013).
 *
 * Platform-neutral like @taxreporter/core: no Node.js built-ins and no DOM,
 * enforced by `make build` (tsconfig.build.json).
 */
export const PACKAGE = "@taxreporter/pipeline";

export {
  buildHoldings,
  type AccountHoldings,
  type AccountLabel,
  type AccountPositionRow,
  type FileReach,
  type HeldLot,
  type HeldSecurity,
  type Holdings,
  type HoldingsInput,
} from "./holdings.js";
export {
  buildReturns,
  coverageOf,
  prepareReturns,
  readExports,
  type AccountChoice,
  type BuildInput,
  type ExportFile,
  type Prepared,
  type PrepareInput,
  type ReadExports,
  type ReadInput,
} from "./prepare.js";
