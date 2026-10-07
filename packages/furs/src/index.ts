/**
 * @taxreporter/furs — FURS eDavki forms: form builders, schema-ordered XML
 * writers and XSD validation for Doh-KDVP (capital gains) and Doh-Div
 * (dividends). Skeleton only; no builder or writer has landed yet.
 *
 * The official schemas are vendored byte-for-byte under ../schemas/ — see
 * schemas/README.md for their sources and SHA-256 pins.
 *
 * Platform-neutral like @taxreporter/core (browser app and CLI): no Node.js
 * built-ins, enforced by `make build` (tsconfig.build.json). Only the tests may
 * use Node.js, to read the vendored files.
 */
export const PACKAGE = "@taxreporter/furs";
