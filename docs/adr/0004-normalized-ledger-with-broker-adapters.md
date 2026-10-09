# 4. Normalize every broker into one ledger and match lots per ISIN across brokers

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** decided during project setup; nothing ships with
> this ADR yet beyond the package skeleton. Remove this note when the first implementation
> merges.
>
> **Superseded in part by [ADR 0011](0011-import-contract-for-broker-files.md) (2026-10-08).**
> The note below describes the contract before ADR 0011. Under ADR 0011, an event's identity is
> its account and its key, and the checks live in `validateLedger`
> (`packages/core/src/validate.ts`), not in the engine. A day's events are ordered by the
> brokers' timestamps first, and splits merge per account. Provenance is a file ID, part and
> row, never a file name.
>
> **Ledger contract as implemented (2026-10-08, `packages/core/src/fifo.ts`).** An event's
> identity is its broker and its key: two brokers' keys never collide. A repeat from another
> file with the same content is an overlap and is dropped (counted); a repeat inside one file,
> or one with other content, blocks. A split happens to the security, so reports of one ratio
> from different brokers within 14 days are applied once; a different ratio, or a trade at the
> later-reporting broker between the two dates, blocks. The engine checks every event as it
> comes in and orders same-day events by broker and key, never by loading order. Still open,
> from the threat model of the import boundary, for the architecture review: an account scope
> on every event, reconciling overlapping files per account, and an opaque file ID in place of
> the file name in `SourceRef`.

## Context

FURS requires FIFO per security across all of the taxpayer's holdings. In the research, the
maintainers of ib-edavki and FURS guidance both say lots do not reset per broker. Every
existing open-source tool handles one broker and matches lots inside that broker's file, so
anyone with two brokers cannot get a correct result from them (persona Luka).

The same tools also share recurring defects (`docs/research/05-prior-art.md` §6):

- corporate actions are guessed;
- withholding-tax reversals end up as duplicates;
- rows the parser did not recognize disappear;
- format drift breaks parsing silently.

## Decision

- **One ledger model.** Each broker adapter converts exactly one export format into the
  broker-independent **ledger events** defined in `packages/core`: trade, dividend,
  withholding tax and its reversal, interest, fee, corporate action, transfer. Every event
  carries its provenance (file, sheet, row) and the original source strings.
- **Detection by content.** An adapter recognizes its format by headers or structure, never
  by file name. A registry maps every known header revision to the adapter that reads it.
- **Every row is accounted for.** It becomes an event, an explicit `ignored(reason)` record,
  or a blocking diagnostic.
- **Lots are matched centrally.** FIFO runs in `packages/core` per ISIN over the merged
  events of all imported files. Overlapping exports are deduplicated by a stable event key.
- **Unsupported corporate actions block.** They produce a diagnostic that names the event;
  the engine never guesses. Supported ones come from structured fields: IBKR corporate-action
  records, and Trading 212 `Stock split open/close` pairs.
- **Priority order:** Trading 212, Interactive Brokers, eToro, Robinhood, then the rest.

## Consequences

- **Adapters stay small and testable in isolation.** FX conversion, lot matching and XML
  generation are written and tested once.
- **The ledger model is the project's most important contract.** Changing it means updating
  every adapter, so it gets its own review.
- **Users must load every relevant export.** A multi-broker user has to load all of them,
  including earlier years whose purchases are still open. The UI must ask for this and say
  when it is missing.
- **Some imports refuse to proceed.** Refusing unknown events means some files will not finish
  until an adapter learns the event type. That is preferable to a silently wrong return.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
