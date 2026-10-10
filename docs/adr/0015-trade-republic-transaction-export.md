# 15. Trade Republic transaction export

**Date:** 2026-10-09
**Status:** Accepted (2026-10-09)

> **Implementation status (2026-10-09):** on `main`, not yet in a release, in
> `packages/brokers/src/trade-republic.ts`. It is tested only against the synthetic export in
> `packages/brokers/test/fixtures/trade-republic/`; no real export has been read yet (#12).
>
> **Superseded in part by [ADR 0017](0017-a-refused-row-withholds-only-the-returns-it-can-change.md)
> (Proposed, 2026-10-10)** for refusals whose adapter states their reach. Trade Republic's
> refusals state none, so a Trade Republic dividend still blocks both returns, as below.

## Context

Trade Republic is the second most used broker among Slovenian investors after eToro
(research 07 §2), and the first of them whose export fits a family TaxReporter already reads.
Since April 2026 it offers a transaction export in CSV (research 07 §4.2): 23 named columns,
every field quoted, one file for the securities account, the cash account and crypto. The
format is known from parser fixtures, at medium confidence, and Trade Republic publishes no
definition of its columns. A search on 2026-10-09 found none either; the one public sample
outside the research, in
[Portfolio Performance issue #6114](https://github.com/portfolio-performance/portfolio/issues/6114),
has no dividend row.

Its savings plans of funds are what many first-time filers hold, the beginner persona's case:
monthly purchases, one sale.

## Decision

1. **Recognized by its exact header**: the 23 columns, in any order, and no other. A revision
   that adds or drops a column is a new format with its own fixture, not read on a guess.
2. **Dates by the one date policy** (ADR 0011 §7). `datetime` is a UTC instant; `date` is the
   Berlin calendar date, and Berlin shares Ljubljana's time zone. So the two must agree: a row
   whose date is not the Ljubljana date of its instant cannot be dated, and is refused
   (`invalidTime`).
3. **Trades.** `BUY`, `SELL` and `SAVINGS_PLAN_EXECUTED` of a `STOCK` or a `FUND`, at `price`
   in `currency`, the quantity the absolute `shares`. A purchase's `shares` must be positive and
   a sale's negative. Fees and the cash `amount` are not used as values: costs are covered by
   the normed costs, as for every broker (research 04 §4.2), and no FX rate of Trade
   Republic's is used; `amount` is only checked (decision 8).
   `asset_class` `FUND` marks a fund, which the export states rather than leaving it to a name.
4. **One account.** `account_type` names the kind of account, not the account, and only
   `DEFAULT` is known. Every file is taken for the one taxpayer's account (one client per
   session, ADR 0011 §11): overlapping exports are read once, and the question about other
   brokers' unnamed accounts does not apply to it. The trade-off: a second person's export
   added by mistake would be pooled with the first; keying files apart instead would make
   every overlapping export read as two accounts.
5. **Cash rows.** Deposits, withdrawals and card spending are ignored rows with their reasons.
   Interest is ignored with a warning, as it belongs on Doh-Obr.
6. **Refused, not guessed:**
   - **dividends**, with a finding of their own (`unconfirmedAction`): their treatment is
     settled, but what `amount`, `tax` and `original_amount` hold on a dividend row is not.
     The research's reading (gross in euros, withholding in euros, gross in the original
     currency) would put Trade Republic's own conversion into Doh-Div, which no BSI rate
     replaces without knowing what was converted. One real, anonymized export with a foreign
     dividend settles it;
   - free shares (`BENEFITS_SAVEBACK`, `STOCKPERK`, `BONUS`), whose cost basis is a tax
     question;
   - corporate actions and deliveries (by category), migrations, redemptions, maturities and
     private-market purchases;
   - bonds, private funds, crypto and any other asset class;
   - any type, category or account type the adapter does not know (`unknownAction`, the text
     wrapped as untrusted).
7. **Keys** are built from `transaction_id` and the row's content without an ordinal
   (ADR 0011 §5): a row repeated inside one file blocks as a repeat instead of counting twice.
   That Trade Republic never reuses an ID is an assumption from the format (a UUID per row),
   not a documented rule; if it ever did, two rows with the same ID and content would block as
   a repeat, never be merged.
8. **A trade's figures are checked.** Its cash `amount` must be its quantity times its price,
   give or take its fee and a cent; a price in another unit, or another row's amount, shows
   there. A trade with a foreign leg (`original_amount`, `original_currency` or `fx_rate`
   filled) is refused (`unconfirmedAction`) until a real export shows which currency its price
   is in.

## Open questions

- **Is `datetime` when the trade was executed, or when it was booked?** The tax date must be
  the trade (contract) date, never settlement. Research 07 does not say, and the agreement
  between `datetime` and `date` cannot tell, as both describe one event. A trade executed on
  30 December and booked on 2 January would land in the wrong tax year. A real export, or
  Trade Republic's own confirmation PDF beside it, settles this before the adapter ships.
- **What a dividend row's columns hold** (decision 6).
- **Does a trade keep its `transaction_id` from one export to the next?** Overlapping exports
  are read once only if it does (decision 4). If Trade Republic issued IDs per export, the
  same trade in two files would count twice. Two overlapping real exports settle it.

## Consequences

- **A Trade Republic user can file Doh-KDVP**, savings plans and share sales included, from the
  export alone.
- **A dividend blocks both returns** until decision 6 is settled, as any finding from reading a
  file does (ADR 0013 §9). The finding says why, and what would settle it.
- **The format is unconfirmed.** As with every adapter, a real, anonymized export has to pass
  before the adapter ships; the fixture's README says so.
- **The web app names Trade Republic** among the brokers it reads.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [x] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0015` (2026-10-09): 0 flagged. The
      script matches only the spelling `ADR-0015`, so the issues that write `ADR 0015` were
      read by hand: #12, all filed on 2026-10-09 from the settled text.
- [x] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Count: **0**.
