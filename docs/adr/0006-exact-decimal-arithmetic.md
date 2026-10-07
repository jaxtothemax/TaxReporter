# 6. Use exact decimal arithmetic and round only at form fields

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** decided during project setup; nothing ships with
> this ADR yet beyond the package skeleton. Remove this note when the first implementation
> merges.

## Context

Existing tools use binary floating point. Quantities rounded to 4 or 5 decimals then leave
`-0.00000001` shares at the end of a position. eDavki accepts 8-decimal quantities and
per-unit prices on Doh-KDVP and 2-decimal amounts on Doh-Div. Trading 212 reports
fractional quantities with up to 10 decimals. A rounding residual turns into a rejected
import or a wrong running balance (`F8`).

## Decision

- **Money, quantities and rates are never JS `number`s.** They use one decimal type exported
  by `packages/core`, a thin wrapper over an arbitrary-precision decimal library chosen in
  the implementing PR (with a `dependency` review).
- **Parsers keep the original string** next to the parsed value.
- **Round once, at the form field.** Intermediate results are not rounded. Rounding happens
  only when writing a form field, at that field's scale (for example 8 decimals for KDVP
  `F3`/`F4`, 2 for Doh-Div `Value`), with an explicit rounding mode that every field mapping
  documents.
- **Residuals are reconciled in the open.** They are recorded explicitly with a diagnostic,
  never hidden. The engine may close a position whose remaining quantity is below an explicit
  epsilon only with a visible note.

## Consequences

- **Exact and reproducible.** Arithmetic is exact, and golden files compare byte for byte.
- **A little more ceremony.** The code is slightly more verbose than plain numbers. A lint
  rule or code review must catch `number` used for money.
- **One documented rounding policy per field.** The UI and the audit report can then explain
  every rounded value.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
