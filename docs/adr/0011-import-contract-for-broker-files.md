# 11. Import contract for broker files

**Date:** 2026-10-08
**Status:** Accepted (2026-10-09)

> **Implementation status (2026-10-09):** on `main`, not yet in a release. Items 1–10 are in `packages/core/src/{ledger,dates,diagnostics,limits,keys,validate}.ts`,
> `packages/brokers/src/{intake,adapter,time,trading212}.ts`, `apps/cli/src/{intake,index}.ts`
> and, since ADR 0013, `packages/pipeline/src/prepare.ts`, which both apps call. PII canaries run
> over an adapter's findings and keys (`trading212.test.ts`) and over the CLI's whole text and
> JSON output (`apps/cli/src/index.test.ts`). The XML family adapter (Interactive Brokers, ADR
> 0012) and the web worker (items 1 and 11 in the browser, ADR 0013) are on `main` too. Not every limit has a test at its value
> as well as one past it yet.
>
> **Superseded in part by [ADR 0017](0017-a-refused-row-withholds-only-the-returns-it-can-change.md)
> (Proposed, 2026-10-10).** Decision 9's "an adapter's refused row included, withholds both
> forms" no longer holds for a refusal whose adapter states its ISIN, date and effect on a
> holding: it withholds only the returns of the prepared year that it can change.

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

1. **Intake is bytes in, and shared.** One `importFile({ bytes, fileId, accountGroup })` in
   `packages/brokers`, used by both the CLI and the web worker. It is synchronous; the web
   app keeps it off the main thread by running it in the worker. It runs these steps in
   order:
   1. **Byte cap.**
   2. **Magic-byte sniff:**
      - refused with their own message: legacy XLS, PDF, gzip, UTF-16 and UTF-32;
      - a ZIP goes to the XLSX family (ADR 0014, 2026-10-09), which refuses any ZIP that
        is no workbook with its own message, as this sniff did before;
      - refused outright: any NUL byte.
   3. **Fatal UTF-8 decoding.**
   4. **Family by content:** XML when the first non-blank character is `<`, else CSV (and,
      with ADR 0014, XLSX for a ZIP holding a SpreadsheetML workbook).
   5. **Exactly one matching adapter**, or the file is refused.

   The file's extension is only a hint. Byte-identical files collapse at intake: the caller
   computes `fileIdOf(bytes)` and reads a repeated ID once, after comparing the bytes. Two
   different files with one ID can only be made on purpose; neither second file is read, and a
   blocking `fileIdClash` withholds the forms. Reading the file from disk stays with the CLI: a
   regular file, opened without blocking (a FIFO is refused, never waited on), its size checked
   through the opened descriptor.
2. **Opaque file IDs.** `SourceRef` becomes `{ fileId, row, part? }`.
   - `fileId` is a prefix of the file's SHA-256.
   - `part` names a sheet or an XML section.
   - The file's name lives only in the UI's own state (the web main thread, or the CLI's
     arguments) and never enters the pipeline.
3. **Adapters by family, with a context.**
   - A family adapter's `read` is synchronous and takes a `ReadContext`: the file's ID and
     the account group the user put it in. Nothing else about the file reaches it, its name
     least of all.
   - The adapter makes its keys with core's `keyBuilder()`, one per file, and dates events
     with core's `taxDate`. `importFile` caps its diagnostics.
4. **Account scope on every event**, including ignored rows.
   - Identity is `(account, key)`.
   - FIFO still runs per ISIN across every account and broker (ADR 0004). Scope splits
     identity and reconciliation only, never lot matching.
   - Where a file names its account (IBKR), the scope is `accountScope(broker, id)`: the
     broker and a hash of the ID. That hash is a pseudonym, not anonymity. An account number
     has few enough values to try them all, so a scope stays on the device with the ledger,
     and never enters a diagnostic, an export or the LLM payload.
   - Where it does not (Trading 212), the app asks whether files belong to the same
     account, defaulting to yes, and records the answer for the audit report. The scope is
     `accountGroup(broker, n)`. The CLI's `--accounts separate` numbers the groups by file ID,
     so the order the files are given in cannot change the return.
   - A label is a group number up to the files a session may hold, or the 32 hex digits of a
     hashed ID. `validateLedger` refuses anything else, a raw account number included.
   - A wrong "same account" answer surfaces through reconciliation (item 6). A wrong "separate
     accounts" answer surfaces here: two accounts of one broker holding the same trade key are
     one account taken for two, and every shared trade would count twice, so it blocks
     (`accountsShareEvents`). A shared dividend only warns, since two real accounts holding as
     many shares are paid alike. A shared split says nothing: every account that held the
     security books it.
5. **One key builder in core.**
   - It takes a canonical JSON tuple: kind, the row's parts with each Decimal in canonical
     form, the source ID when present, and an occurrence ordinal within the file.
   - The tuple is hashed with SHA-256 (`@noble/hashes` 2.4.0, pinned exactly) and truncated
     to 128 bits. A file ID is the first 64 bits of the SHA-256 of the file's bytes
     (`fileIdOf`). `packages/core/src/keys.ts` is the only module that imports the library,
     and known answers computed with `shasum` pin both.
   - No raw account or order number survives in a key.
   - Of several reports of one event, the one with the smallest `(fileId, part, row)` stands.
   - A broker that gives every row an ID it never reuses (Interactive Brokers) keys on it with
     `keyOf`, which adds no ordinal, so a row repeated in one file blocks as a repeat
     ([ADR 0012](0012-interactive-brokers-flex-xml-import.md) §9).
6. **Overlap reconciliation**, per account, file pair and kind, on the broker's own clock.
   - The overlap is the time both files recorded, read from their events, since no export
     states its range.
   - Both files have events of a kind inside their overlap and the key sets differ: the
     import blocks. A key repeated within one file blocks on its own already.
   - One file has none of that kind, as with an export that left a category out: a warning.
7. **The broker's clock on every event, one date policy in core.**
   - Events carry `at: { instant, brokerDate }`. A core function derives the tax date from it.
   - For now that is the Ljubljana calendar date of the instant where there is one, with a
     warning wherever it differs from the broker's date.
   - The final rule needs a FURS or ZDoh-2 source (research 06, open questions). Changing it
     is then one policy change plus golden files.
   - The clock also orders lots within a day. FIFO disposes first of what was acquired first
     (ZDoh-2 Art. 103(1), research 04 §4.4), so a day's lots are taken by their instants
     where the exports give them. Otherwise the order is fixed (broker, account, key), and
     the engine warns when it decided a sale (`sameDayLotOrder`).
   - Open for the IBKR adapter: research 06 §2 keeps IBKR's exchange date as it is, so its
     events carry no instant under this policy, and its same-day lots are not ordered by time.
8. **Typed diagnostics.**
   - Each code has a parameter shape.
   - Text copied from a file travels only in an `UntrustedText` wrapper, shown on screen and
     never logged.
   - A file a finding is about besides its source travels as a `FileRef`, which the screen
     names with the user's file name.
   - `forExport` drops `source`, every `FileRef` and every wrapper for logs, bug reports and
     the LLM check. A file ID is the same in every session and would link two reports.
9. **One validation point.** `validateLedger(events, carried)` returns a `ValidatedLedger`
   brand: the checked events, one report each, in file and row order, and every finding.
   `carried` is what reading the files found. Deduplication, FIFO and both builders require
   the brand. A blocking finding in the ledger, an adapter's refused row included, withholds
   both forms. The ledger's events are frozen down to their parts, so what FIFO and the forms
   read is what was checked.
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
  - XLSX number cells (an ADR 0006 exception), now proposed by ADR 0014, and CSVs with
    preamble lines, both before the eToro and Schwab adapters;
  - a cross-check of the account holder;
  - the fund flag from an ISIN source instead of the name;
  - calibrating the worker's watchdog.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [x] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0011` (2026-10-09): 0 flagged. The
      script matches only the spelling `ADR-0011`, so the issues that write `ADR 0011` were
      read by hand: #11, #13, #16, all filed on 2026-10-09 from the settled text.
- [x] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Count: **0**.
