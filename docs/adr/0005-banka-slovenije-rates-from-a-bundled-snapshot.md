# 5. Convert with Banka Slovenije rates from a bundled, CI-refreshed snapshot

**Date:** 2026-10-07
**Status:** Accepted (2026-10-07)

> **Implementation status (2026-10-07):** the snapshot and the lookup ship in
> `packages/fx`: `data/bsi-daily.csv`, `data/bsi-monthly.csv` and `data/snapshot.json`
> (built by `scripts/build-snapshot.mjs`, attribution in `data/DATA-NOTICE.md`), read by
> `RateTable` with the 10-day lookback, the monthly fallback, the euro changeover rates,
> minor-unit quotes (GBX and the like) and a warning on the six known BSI≠ECB values. Not
> yet built: the scheduled refresh and ECB cross-check in CI, the app downloading a newer
> snapshot, and the InforEuro rate for RUB and BYN. Until then a RUB amount after
> 2022-03-01 gets `noRate`, which the pipeline must report as a blocking diagnostic.

## Context

ZDoh-2 Articles 16(6), 98(9) and 99(3) require foreign-currency amounts to be converted at
the rate **published by Banka Slovenije** that is valid on the day of acquisition, disposal
or income. Research (`docs/research/03-bsi-exchange-rates.md`) established the following:

- **Mostly ECB rates, but not exactly.** BSI's daily list republishes the ECB reference
  rates, but six (date, currency) pairs since 2007 differ. One of them is in tax year 2025:
  NOK on 2025-10-23.
- **Weekends and holidays.** On weekends and TARGET holidays BSI's own lookup returns the
  last list published before the date.
- **Currencies outside the daily list** (TWD, ARS, AED and others) are on the BSI monthly
  list.
- **No CORS.** BSI's XML files and API send no CORS headers, so a browser app cannot fetch
  them.
- **Redistribution is allowed.** The data may be redistributed with attribution (CC BY 4.0
  via OPSI) as long as values are not modified.

Existing tools variously use ECB rates, the broker's own rate, or BSI with ad-hoc fallbacks.

## Decision

- **A committed snapshot.** `packages/fx` ships a snapshot built from `dtecbs-l.xml` (daily)
  and `EksotTecBS-l.xml` (monthly). It keeps BSI's original decimal strings and records the
  source URL, retrieval time, `Last-Modified` and SHA-256 of the raw files.
- **Daily refresh in CI.** A scheduled GitHub Action:
  - rebuilds the snapshot after 17:00 CET;
  - re-diffs the whole history;
  - cross-checks against ECB, failing on any difference outside an explicit allow-list of the
    known discrepancies;
  - opens a PR.
- **Lookup rule:**
  1. the latest daily list on or before the date, looking back at most 10 days (the largest
     real gap is 5);
  2. otherwise the monthly list valid for that month;
  3. for RUB and BYN, which BSI does not publish, the EC InforEuro rate behind a blocking
     warning;
  4. otherwise an error.
- **Arithmetic:** `EUR = amount / rate`. Every converted amount keeps its provenance (source,
  list date, rate).
- **Never substitute.** The broker's FX rate and the ECB rate are never used in place of
  BSI's. ECB data is used only by the CI cross-check, never by the app.
- **Dates newer than the bundled snapshot:** the app may download the latest snapshot the
  project publishes with the site (its own origin, no user data in the request; ADR 0002).
  If the rate is still missing, the app reports "rate not yet published by Banka Slovenije"
  as a blocking diagnostic instead of guessing.

## Consequences

- **Deterministic and offline.** The same input always gets the same rate, offline, and the
  known NOK difference comes out right.
- **The snapshot needs upkeep.** It adds about 25 KB gzip per year of data and needs a CI job.
  The app loads only the years it needs.
- **Attribution is required.** It goes in the data directory and the app's About screen.
- **Recent dates can be stale.** Transactions newer than the bundled snapshot need the
  published-snapshot download or an app update. This matters little in practice, since filing
  happens months after the tax year ends.
- **The app makes no third-party rate requests.** Even a rate lookup would tell a third party
  which currencies and dates a user holds, so the app only ever contacts the project's own
  origin.

## On Acceptance

Accepted at project setup, before the issue tracker existed: `scripts/adr-accepted-issue-sweep.py`
had 0 open issues to re-read.
