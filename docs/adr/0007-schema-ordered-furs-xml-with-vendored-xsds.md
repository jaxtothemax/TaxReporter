# 7. Generate FURS XML in schema order and validate it against vendored XSDs

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** the Doh-KDVP and Doh-Div validators and writers
> ship in `packages/furs` (`kdvp.ts`, `div.ts`, built on the escaping writer in `xml.ts`), with
> golden files validated against the vendored XSDs in tests. Not yet built: the scheduled
> drift check and validation inside the browser app.
>
> **Test-time validator:** `xmllint-wasm` 5.3.0, pinned exactly, a devDependency of
> `packages/furs` used only from `packages/furs/test/xsd.ts` (dependency review
> 2026-10-07). It embeds **libxml2 2.13.8, an end-of-life branch** that `pnpm audit` and
> the osv-scan job cannot see, because they match package versions. Its exposure is low:
> it only validates our own golden files against SHA-256-pinned schemas, and none of the
> libxml2 CVEs since 2.13.8 is reachable through plain schema validation of such input.
> Revisit it before any use in the browser, where the XML derives from hostile broker files,
> or when a libxml2 CVE reachable through schema validation is published. GitHub's Ubuntu
> runner ships no system xmllint, so that is not an alternative for CI.

## Context

Most user-reported bugs in existing tools are rejected imports (`docs/research/05-prior-art.md`
§6): wrong element order, values too long or too precise, empty typed elements, misread
`F2` codes, missing namespaces. Research (`01-furs-doh-kdvp.md`, `02-furs-doh-div-and-others.md`)
found further problems:

- **FURS edits schemas in place.** `Doh_KDVP_9.xsd` gained codes J and K in 2025–2026
  without a version change.
- **The XSDs leave some FURS rules out.** They do not encode:
  - a required tax number;
  - at least one purchase and one sale per list;
  - per-list-type `F2` semantics (B = purchase on PLVP, A = purchase on PLVPSHORT);
  - `ForeignTax <= Value`.
- **Almost no tool validates its output before export.**

## Decision

- **Vendored schemas.** The official XSDs (`Doh_KDVP_9`, `Doh_Div_3`, `EDP-Common-1`, plus
  `Doh_Obr_2` and `D_IFI_4` for later forms) are vendored byte for byte into
  `packages/furs/schemas/`. Their source URL, retrieval date and SHA-256 are recorded.
- **Writers follow the XSD.** Each form has a typed model and a writer that emits elements in
  XSD order through an escaping XML API. Optional elements without a value are omitted, never
  emitted empty.
- **Validation in two layers:**
  - every golden file in the test suite is validated against the vendored XSDs;
  - a business-rule validator, run before every export in the app, enforces the rules the
    XSD does not.
- **Drift check.** A scheduled CI job downloads the live XSDs and fails (and opens an issue)
  when a SHA-256 changes. A schema change is treated as a tax-rule change.

## Consequences

- **No rejected imports.** Output is checked before the user ever sees an import error.
- **Validation in the app is a separate decision.** Running XSD validation in the browser as
  well would need a WebAssembly libxml2. Whether to ship it is decided in the implementing PR;
  tests always run it.
- **FURS changes become visible.** Schema updates appear within a day instead of at filing
  time.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
