# 12. Interactive Brokers Flex Query XML import

**Date:** 2026-10-08
**Status:** Proposed

> **Implementation status (2026-10-08):** built on branch `feat/ibkr-adapter`, not yet on
> `main`, in `packages/brokers/src/{xml,ibkr,adapter}.ts` with core changes in
> `packages/core/src/{ledger,keys,fifo,validate,diagnostics,limits}.ts`. Tested only against
> the synthetic statement in `packages/brokers/test/fixtures/ibkr/`; no real export has been
> read yet.

## Context

Interactive Brokers (IBKR) is the second broker after Trading 212, and the first whose export
is XML: an Activity Flex Query, one `FlexStatement` per account (research 06 §3). A Slovenian
client migrated from IB UK to IB Central Europe and then IB Ireland holds several accounts in
one file. It is a new trust boundary: until now no code read XML from a user's file. A threat
model on 2026-10-08 named the risks: XML tricks (DTD, entities, expansion), a file cut short
or edited so that rows drop silently, summary rows counted twice, withholding joined to the
wrong dividend, a split ratio taken on trust, account and personal data leaking. The
architecture review that should have followed was cut short by usage limits; the decisions
below were made from the threat model and the research, and are open to review.

## Decision

1. **A strict XML scanner of our own** (`xml.ts`), not a general parser. It runs in Node and in
   a browser worker alike and reads only elements and attributes:
   - no DOCTYPE, so no DTD, no entities beyond XML's five, nothing external or expanding;
   - no CDATA, text content, namespaces or prefixes; no processing instruction but an optional
     UTF-8 `<?xml …?>` declaration at the very start; comments are skipped;
   - every character, written or from a reference, one XML allows (`&#0;` is refused);
   - one pass by index, no recursion, no regular expression over the rest of the text; bounded
     by `LIMITS.xmlDepth`, `xmlAttributes`, `cellLength`, 64-character names and an element
     cap; the first error stops it and names a line, never a value.
2. **XML family dispatch.** `importFile` peeks at the root element and hands the text to the
   one XML adapter whose `matches` accepts it, as it does for CSV headers.
3. **Every section is known.** Sections holding transactions (`Trades`, `CashTransactions`,
   `CorporateActions`, `Transfers`, `SecuritiesInfo`) are read; sections that only summarize or
   value them (`OpenPositions`, `CashReport`, `ChangeInNAV`, …) are skipped whole; any other
   element blocks (`unknownElement`), so a section IBKR adds can never drop rows unseen.
   Unknown *attributes* are ignored: IBKR keeps adding fields, and only an allowlist is read.
4. **Executions only.** `Trade` rows with `levelOfDetail="EXECUTION"` and `transactionType`
   `ExchTrade` or `FracShare` become trades; order, symbol-summary, asset-summary and
   closed-lot rows become ignored rows with the new reason `summary`, as do cash `SUMMARY`
   rows. A statement with summaries and no detail blocks (`summaryOnly`).
5. **Refused, not netted on a guess:** cancellations and corrections, book and DVP trades,
   notes `Ca`, `Co`, `Re`, `A`, `Ex`, `Ep`, short sales (`C;O`, a sell that opens, a buy that
   closes), a buy/sell that disagrees with the quantity's sign, a multiplier other than 1, a
   trade whose `tradeMoney` misses quantity × price by more than a cent, a CUSIP that
   disagrees with a US or Canadian ISIN, payments in lieu of dividends, distributions that are
   not dividends (return of capital, capital gains, partnership), every corporate action but a
   forward or reverse split that keeps its ISIN, bonds, bills, commodities and crypto.
6. **Derivatives beside shares are ignored with a warning**, like interest: options, futures
   and CFDs are taxed on D-IFI, which this version does not build, and they create no share
   lot. Exercises and assignments, which do, are refused (decision 5). FX conversions are
   ignored as currency conversions; transfers between accounts as `securitiesTransfer`: a move
   creates and ends no lot, and a sale without a purchase anywhere still blocks.
7. **Accounts.** A statement's `accountId` must look like an individual or joint account
   (`U` and 5–10 digits); a paper account (`DU…`) or anything else blocks, as does a row or an
   `AccountInformation` naming another account, or more than `LIMITS.accountsPerFile` (10)
   accounts in one file. The scope is `accountScope("ibkr", accountId)`, a hash.
8. **Dates** are IBKR's default `yyyyMMdd` (with an optional `;HHmmss`), taken as the exchange
   date with no instant (research 06 §2, ADR 0011 §7). Another format, a period that runs
   backwards, ends after the statement was made or spans over 366 days, or a row dated after
   the statement was made, blocks. A file reaches, per account, to its statement's `toDate`.
9. **Keys from IBKR's own IDs.** IBKR never reuses a `transactionID` (or a corporate action's
   `actionID`), so the key is `keyOf(kind, [id])`: no ordinal, unlike `keyBuilder`. A row
   listed twice in one file gets one key twice and blocks as a repeat (`duplicateKeyInFile`)
   instead of being counted twice. This adds a second key form to ADR 0011 §5.
10. **Withholding joins its dividend** only within its statement, by ISIN, currency and pay
    date, and by `actionID` where both rows carry one. No candidate or several block
    (`withholdingUnlinked`, `withholdingAmbiguous`); tax with no security is tax on interest and
    is ignored. A negative dividend reverses the latest earlier dividend of the same ISIN,
    currency and amount; the pair is ignored (`reversed`) together with its tax, which must
    cancel; an unmatched reversal blocks.
11. **Splits are checked, not trusted.** IBKR reports the shares a split added, not its ratio.
    The ratio is read from the description (`SPLIT a FOR b`, an anchored, bounded pattern) and
    the split carries the reported change as `positionChange`. FIFO then checks that the
    ratio turns the shares that broker's lots hold into exactly that change, and blocks
    (`splitPositionMismatch`) otherwise, or when the broker holds none: a wrong ratio would
    restate every lot of the security, other brokers' too.
12. **No personal fields.** Names, addresses, aliases, models, order references, a transfer's
    counterparty and the descriptions of deposit, withdrawal and fee rows are never read.
    Account and transaction IDs go only into hashed scopes and keys. Security names are
    cleaned of control, format and separator characters as they are read.

## Consequences

- **Real users will hit refusals.** ISIN-changing reverse splits, payments in lieu, trade
  corrections, withholding adjusted in a later period, fractional cash in lieu after a reverse
  split: each blocks with its own finding until a real, anonymized export shows how to read it
  safely. The fixture is synthetic; the first real exports will decide which refusals to lift.
- **The web app's findings catalog** must say every new code in both languages
  (`unknownElement`, `summaryOnly`, `withholdingUnlinked`, `splitPositionMismatch`,
  `derivativesNotCovered` and the rest), and the XML reasons of `unreadableFile`.
- **The split check** applies to any broker that reports a split's change rather than its
  ratio; Trading 212's splits keep their exact ratio from the two position rows.
- **A skipped-section list to maintain.** A section IBKR adds blocks until it is classified.

## On Acceptance

<!-- Complete when this ADR's Status moves to Accepted — not before. -->
- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0012`
- [ ] Any issue carrying pre-ADR scope rewritten — **title and body** — led by a
      dated correction note. Record the count here, **including zero**.
