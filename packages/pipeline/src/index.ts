/**
 * @taxreporter/pipeline — the one way from broker exports to returns: intake
 * of every file, the checked ledger, the coverage end and both builders.
 * The CLI and the web app both call it, so the same files give the same XML
 * in both (ADR 0013).
 *
 * Platform-neutral like @taxreporter/core: no Node.js built-ins and no DOM,
 * enforced by `make build` (tsconfig.build.json).
 */
export const PACKAGE = "@taxreporter/pipeline";

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
