# 17. Holdings, the as-of rule and account labels

**Date:** 2026-10-10
**Status:** Proposed

> **Implementation status (2026-10-10):** the engine half ships with this ADR in the
> first pull request for #47: `holdingOutlook` and the `through` cut on `matchFifo` in
> `packages/core/src/holding.ts` and `fifo.ts`, `accountPositions` in
> `packages/core/src/holdings.ts`, `buildHoldings` in `packages/pipeline/src/holdings.ts`
> (`Prepared.holdings`), and `holdings` in the CLI's `--json` report. The dashboard that
> shows them, and the flow change in decision 6, follow in later pull requests for #47.

## Context

The web app's review step shows what the two returns hold. Its owner wants a dashboard
after the files and details steps instead (#47), one that also shows the shares still held
and gives each broker account its own section, so the user can check each against its
broker. A Voice of the Customer panel and an architecture review fed the decisions below;
the owner settled the open ones on 2026-10-10 (#47, comments).

"Shares still held" has two honest answers, and they differ whenever a security is held in
two accounts and sold in one:

- **Per account:** what the broker's own app shows, the shares each account bought less
  those it sold.
- **Across accounts:** the FIFO lots still open. ZDoh-2 Art. 103(1) puts FIFO on the
  taxpayer, not the account (`docs/research/04-si-tax-rules.md` §4.4), so a sale at one
  broker consumes the oldest lot at any broker, and the lots a next sale will be taxed
  against are the open FIFO lots, wherever they were bought.

The FIFO engine already had the open lots (`SecurityHistory.open`); the Doh-KDVP builder
dropped them. Account scopes, which identity and overlap checks key on, are a broker name
and a hash of the account's own ID (ADR 0011 §4): an IBKR account number has few enough
values to try them all, so a scope is a pseudonym that must never leave the device's
engine, let alone reach a screen or an export.

## Decision

1. **Both views, computed in the engine.** `buildHoldings` in `@taxreporter/pipeline`
   returns, beside the returns and never part of them:
   - per account, its non-zero **positions** (signed quantities, split-adjusted, from
     `accountPositions` in core) — quantities only, since a broker's own cost basis is not
     FIFO's;
   - per security, its **open FIFO lots** across every account, each costed as the form
     will cost it: the contract price over the splits since, at the BSI rate of the purchase
     date, rounded to Doh-KDVP's 8 decimals (`unitValueEur`, shared with the builder), times
     the quantity, in cents. No commission (04 §4.2), and no loss disallowed by the 30-day
     rule is added: the rule leaves acquisition values alone (04 §5.3).

   The UI does no arithmetic on either (ADR 0006).

2. **The as-of rule.** An account's positions are as of its own last covered day (the
   latest date of any of its rows, as `AccountReach` reports it). A security's lots are as
   of the **earliest** last covered day among the accounts that still hold it, and `matchFifo`
   reads that security only through that day (`through`): after it, one of those accounts
   may have traded the security unseen. An old, closed account no longer holding the
   security does not hold its lots back, which the session-wide coverage end used by the
   30-day rule would. Where FIFO leaves a lot open, or a sale unmatched, while every
   account's own position nets to zero (a sale whose purchase is in a missing export, then
   a purchase), the accounts those lots and sales belong to stand in for its holders, and
   an old account that only traded it does not; the security is still listed, and flagged. Never today's date: the files are all there is.
   But an account's day may be past the rates snapshot only as far as its own trades and
   splits reach: a deposit dated 2099 says how far a file reaches, not a day its shares
   were held to, and as of 2099 every lot would look exempt. The coverage end clamps to
   the snapshot outright for the same reason; holdings let a trade past it stand, since
   its lot is real, shown as the files claim it and without a cost.

3. **The next bucket's date is the day after the anniversary.** `completedYears` lets the
   anniversary itself complete a year; FURS has published no example of that day (04 §4.5,
   open questions). A date someone may time a sale by has to hold under either reading, so
   `holdingOutlook` gives the anniversary plus one day, and on the anniversary the lot still
   shows the higher rate. The returns keep using `completedYears` unchanged.

4. **Holdings never block.** `buildHoldings` raises no diagnostic; its FIFO runs' findings
   are the returns' to raise. `buildReturns` runs it apart from the returns: a fault in it
   (from a file no test foresaw) gives `holdings: null` and leaves the returns as they are. A lot whose rate the snapshot lacks (bought after it ends) has
   no cost and says why, rather than withholding a return. What may make a view wrong is a
   flag on it instead: an account whose files move shares in or out (`securitiesTransfer`,
   not read yet: #48) is `transferred`; one a blocking finding points into has
   `refusedRows`; a security whose files sell more than they buy is `incomplete`.

5. **Account labels, never scopes, cross out of the pipeline.** Each broker's accounts are
   numbered from 1, the account with the earliest event first, ties by scope, so the same
   files are numbered alike whatever order they come in. What leaves `buildHoldings` names
   an account by that label (`ibkr-1`), its broker and number, its as-of day and its files;
   the scope stays inside. Numbers may change when files are added, which is harmless:
   nothing persists (ADR 0002). This amends ADR 0011 §4 and ADR 0013, which had no account
   on anything crossing to the screen.

6. **The dashboard replaces the review and download steps.** The flow becomes files,
   details, dashboard. Downloads stay gated per form (ADR 0013 §9): a blocking finding in
   one return withholds that return only, one in the ledger withholds both, and none of
   them hides the dashboard. The guided tour (ADR 0016) moves onto it.

## Consequences

- The CLI and the web app show the same holdings, from the same function; the CLI's
  `--json` report carries them.
- A purchase so late that its next bucket's day would be past year 9999 has no next date:
  any year to 9999 passes import, and the date arithmetic must not throw on one.
- Every prepare runs FIFO twice more (once over every event, for each security's merged
  splits and name, and once cut). Both are linear in the events (`fifo.test.ts`).
- Positions are wrong for an account that moved shares, until #48 reads transfers; the flag
  says so. No coverage start is known (#49), so the dashboard can say "as of" but not
  "since".
- Positions and lots add up to the same total only when every account holding a security
  ends on the same day and no shares moved; the dashboard has to say why they may differ.
- Per-account gains, dividends and notes are a follow-up (#50). No tax figure is ever
  given per account: losses offset across accounts.

## Alternatives considered

- **Lots as of the tax year's end.** Ruled out by the owner: the dashboard is for planning
  the next sale, and the files usually reach past the year.
- **One as-of day for every security** (the session's coverage end). Simpler to read, but
  one stale or closed account would make every holding look old.
- **Showing the anniversary with a caveat.** A one-day error costs five percentage points;
  the cautious day costs one day of waiting.
- **Account scopes, or file names, as account identifiers on screen.** A scope can be
  reversed by trying every account number; a file name can carry a client's name.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0017`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
