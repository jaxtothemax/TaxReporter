/**
 * @taxreporter/furs — FURS eDavki forms: the business-rule validators and the
 * schema-ordered XML writers for Doh-KDVP (capital gains) and Doh-Div
 * (dividends), ADR 0007, and the builders that turn ledger events and BSI
 * rates into those forms: Doh-KDVP inventory lists and Doh-Div records.
 *
 * The official schemas are vendored byte-for-byte under ../schemas/ — see
 * schemas/README.md for their sources and SHA-256 pins. The tests validate
 * every golden file against them.
 *
 * Platform-neutral like @taxreporter/core (browser app and CLI): no Node.js
 * built-ins, enforced by `make build` (tsconfig.build.json). Only the tests may
 * use Node.js, to read the vendored files.
 */
export const PACKAGE = "@taxreporter/furs";

// The ISIN check lives in core with the engine that also needs it.
export { isIsin } from "@taxreporter/core";

export {
  buildDohDiv,
  type BuiltDividend,
  type DivBuild,
  type DivBuildInput,
  type DividendsEstimate,
  type PayerInfo,
} from "./build-div.js";
export {
  buildDohKdvp,
  type BuiltList,
  type BuiltLot,
  type BuiltRow,
  type KdvpBuild,
  type KdvpBuildInput,
} from "./build-kdvp.js";
export {
  EDP_NAMESPACE,
  isIsoDate,
  isTaxNumber,
  type IsoDate,
  type Taxpayer,
} from "./common.js";
export {
  FURS_COUNTRIES,
  fursCountryFromIso,
  isFursCountry,
  type FursCountry,
} from "./countries.js";
export {
  DIV_NAMESPACE,
  DIVIDEND_TYPES,
  validateDohDiv,
  writeDohDiv,
  type DividendPayer,
  type DividendRecord,
  type DividendType,
  type DohDiv,
} from "./div.js";
export {
  FormValidationError,
  type FormIssue,
  type FormIssueCode,
  type FormName,
} from "./issues.js";
export {
  ACQUISITION_METHODS,
  KDVP_NAMESPACE,
  validateDohKdvp,
  writeDohKdvp,
  type AcquisitionMethod,
  type DohKdvp,
  type KdvpList,
  type KdvpPurchase,
  type KdvpRow,
  type KdvpSale,
} from "./kdvp.js";
