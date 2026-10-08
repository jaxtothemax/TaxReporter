# 11. Import contract for broker files

**Date:** 2026-10-08
**Status:** Proposed

> **Implementation status (2026-10-08):** decided, not yet built. This ADR records the
> contract that branch `feat/import-contract` implements; until it merges, the ledger in
> `packages/core/src/ledger.ts` still has `SourceRef.file` and no account scope.

## Context

ADR 0004 fixed the shape: one ledger, one adapter per export format, every row accounted
for. The first adapter (Trading 212) and the first consumer (the CLI) then went through a
threat model and an architecture review on 2026-10-08. The ledger contract they found had
these gaps:

- **File names as identity.** It carried the file's name in every event and diagnostic. A
  name can hold a client's name or an account number.
- **No account.** It had no notion of which account an event belongs to, so overlapping
  exports could not be told apart from a second account.
- **One date, no clock.** It recorded a single date with no clock behind it, while the rule
  for which clock decides a trade date is still an open FURS question.
- **Untyped diagnostics.** Two adapters' worth of copied file text sat in untyped
  diagnostic parameters.
- **Text only.** It accepted only text, so the IBKR adapter (Flex Query XML) could not reach
  it at all.

Changing the contract costs one adapter and one CLI today, and every adapter after IBKR.
The user decided the four product questions on 2026-10-08:
- one client per session;
- ask whether Trading 212 files are the same account, defaulting to yes;
- build the date rule reversibly;
- hash keys with `@noble/hashes`.

## Decision

We will change the import contract as follows, before the IBKR adapter is built.

1. **Intake is bytes in, async, and shared.** One `importFile({ bytes, fileId })` in
   `packages/brokers`, used by both the CLI and the web worker. It runs these steps in
   order:
   1. **Byte cap.**
   2. **Magic-byte sniff:**
      - refused with their own message: ZIP and XLSX (until an XLSX adapter exists), legacy
        XLS, PDF, gzip, UTF-16 and UTF-32;
      - refused outright: any NUL byte.
   3. **Fatal UTF-8 decoding.**
   4. **Family by content:** XML when the first non-blank character is `<`, else CSV.
   5. **Exactly one matching adapter**, or the file is refused.

   The file's extension is only a hint. Byte-identical files collapse at intake.
2. **Opaque file IDs.** `SourceRef` becomes `{ fileId, row, part? }`.
   - `fileId` is a prefix of the file's SHA-256.
   - `part` names a sheet or an XML section.
   - The file's name lives only in the UI's own state (the web main thread, or the CLI's
     arguments) and never enters the pipeline.
3. **Adapters by family, with a context.**
   - A family adapter's `read` is synchronous and takes a `ReadContext`. The context gives
     source references, account scopes, the key builder, a capped diagnostic sink and the
     date policy.
   - Adapters never see a file name.
4. **Account scope on every event**, including ignored rows.
   - Identity is `(account, key)`.
   - FIFO still runs per ISIN across every account and broker (ADR 0004). Scope splits
     identity and reconciliation only, never lot matching.
   - Where a file names its account (IBKR), the scope is a hash of it.
   - Where it does not (Trading 212), the app asks whether files belong to the same
     account, defaulting to yes, and records the answer for the audit report.
5. **One key builder in core.**
   - It takes a canonical JSON tuple: kind, the row's parts with each Decimal in canonical
     form, the source ID when present, and an occurrence ordinal within the file.
   - The tuple is hashed with SHA-256 (`@noble/hashes`, pinned exactly) and truncated to 128
     bits.
   - No raw account or order number survives in a key.
   - Of several reports of one event, the one with the smallest `(fileId, part, row)` stands.
6. **Overlap reconciliation**, per account, file pair and kind, on the broker's own clock.
   - Both files have events of a kind inside their overlap and the key multisets differ: the
     import blocks.
   - One file has none of that kind, as with an export that left a category out: a warning.
7. **The broker's clock on every event, one date policy in core.**
   - Events carry `at: { instant, brokerDate }`. A core function derives the tax date from it.
   - For now that is the Ljubljana calendar date of the instant where there is one, with a
     warning wherever it differs from the broker's date.
   - The final rule needs a FURS or ZDoh-2 source (research 06, open questions). Changing it
     is then one policy change plus golden files.
8. **Typed diagnostics.**
   - Each code has a parameter shape.
   - Text copied from a file travels only in an `UntrustedText` wrapper, shown on screen and
     never logged.
   - `forExport` drops `source` and every wrapper for logs, bug reports and the LLM check.
9. **One validation point.** `validateLedger` returns a `ValidatedLedger` brand, and
   deduplication, FIFO and both builders require it.
10. **One frozen `LIMITS` module.** It covers file bytes, files and events per session,
    records per file, columns, cell length, split terms and count, diagnostics per file, and
    XML depth and attributes. Each limit is tested at its value and one past it.
11. **One client per session.** Starting another client discards everything: worker, files,
    figures and the tax number. Nothing is persisted on the shared github.io origin.

This supersedes the parts of ADR 0004's 2026-10-08 note that put `SourceRef.file` and
identity by `(broker, key)` in the contract.

## Consequences

- **Churn now.** The Trading 212 adapter, the CLI, and every test fixture that builds events
  change once, with helpers that default `account` and `at`.
- **Easier later.** IBKR, eToro and the web worker build on a contract that already has the
  account, the clock and the typed diagnostics they need.
- **Privacy by construction.** File names, account numbers and order IDs cannot reach a
  diagnostic's parameters, a key, a log or the LLM payload. A PII canary test in CI checks
  it.
- **Determinism.** Output depends only on the bytes, never on loading order or file names.
  A test loads the same files in shuffled order and compares the XML byte for byte.
- **A new dependency.** `@noble/hashes` joins `packages/core`, pinned and license-checked
  under ADR 0010.
- **The clock rule stays a risk.** It is open until FURS answers, and blocks the first
  release that files a real return. The design keeps the change small.
- **Deferred:**
  - XLSX number cells (an ADR 0006 exception) and CSVs with preamble lines, both before the
    eToro and Schwab adapters;
  - a cross-check of the account holder;
  - the fund flag from an ISIN source instead of the name;
  - calibrating the worker's watchdog.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0011`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
