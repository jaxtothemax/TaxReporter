/**
 * @taxreporter/core — the domain model: decimal money, the ledger, the FIFO lot
 * engine and diagnostics. So far: the exact decimal type (ADR 0006).
 *
 * This package is meant to run in the browser app as well as the CLI, so it
 * stays platform-neutral: no Node.js built-ins. `make build` compiles src/
 * against no Node.js types (tsconfig.build.json), so a stray `node:` import
 * fails the build.
 */
export const PACKAGE = "@taxreporter/core";

export { Decimal, MAX_DECIMAL_LENGTH, type RoundingMode } from "./decimal.js";
