/**
 * @taxreporter/furs — FURS eDavki forms: the business-rule validators and the
 * schema-ordered XML writers for Doh-KDVP (capital gains) and Doh-Div
 * (dividends), ADR 0007.
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
  isIsin,
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
