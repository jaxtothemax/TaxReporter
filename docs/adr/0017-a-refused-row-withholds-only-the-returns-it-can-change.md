# 17. A refused row withholds only the returns it can change

**Date:** 2026-10-10
**Status:** Proposed

> **Implementation status (2026-10-10):** the decision is still Proposed, but its
> implementation lands with it in the pull request for #46: `packages/core/src/reach.ts`
> (`scopeLedger`), the new parameters in `packages/core/src/diagnostics.ts`, the Trading 212
> adapter (`packages/brokers/src/trading212.ts`), both builders, `packages/pipeline/src/prepare.ts`
> (`Prepared.scope`), the web engine and the CLI. Accepting it changes no code.

## Context

ADR 0011 decision 9 and ADR 0013 decision 9 make every blocking finding from reading the files
withhold both returns, for whatever year is prepared: such a finding "can bear on either". For
a file that cannot be read, a row whose action is unknown, or a row with no valid ISIN, that is
right, since nothing is known about what the row would change.

For a refused corporate action it is not. A real Trading 212 history from 2020 to 2026 had
three refused rows, all dated 2025: a takeover paid in shares (the old shares "sold" at a
price of 0, the new shares received at 0, #28) and rights handed out free (#29). Neither
security was sold in 2026, so the rows can change no figure of a 2026 return, yet they withheld
both 2026 returns and would withhold every later year's. #28 had already noted that one
takeover in a user's history blocks every later Doh-KDVP. The user could download nothing.

## Decision

1. **The adapter states facts; core decides.** A refusal may carry the security's ISIN, the
   row's date and what the row does to a holding, `shares`: `"out"` (gives shares up),
   `"in"` (receives shares) or `"rights"` (receives rights). These are new optional parameters
   of `unsupportedAction` and `invalidPrice` (`packages/core/src/diagnostics.ts`). A refusal
   without all three, or with any of them malformed, withholds both returns of every year, as
   before. So does every other code.
2. **Trading 212 states them only in the shapes research has seen** (06 §4.3):
   - a sale at a price of exactly 0 gives its shares up (`invalidPrice`, `"out"`); one with no
     price or a negative one could be anything, such as cash for a fraction of a spin-off
     share, and stays unscoped;
   - a `Custom stock distribution` under a ticker ending in `.RST` receives rights;
   - a `Stock distribution` receives shares only as a takeover's other leg: booked within a
     minute after exactly one sale at a price of exactly 0 in the same file, of another
     security, on the same day, and that sale followed by no other distribution in the minute
     (15 seconds apart, the sale first, in the real export seen, 06 §4.3). Booked alone, or
     beside more than one candidate, it could be a spin-off or a bonus issue booked in a
     batch, which can change the cost of another security or date from a resolution months
     earlier (ZDoh-2 art. 101(6)); it stays unscoped. Pairing sorts the legs once and looks
     each one up, so its work stays bounded whatever a file holds.

   Every other refusal, from Trading 212 or any other adapter, is unscoped.
3. **The rule** (`scopeLedger`, `packages/core/src/reach.ts`), for a scoped refusal of
   security X booked on D, preparing year Y. A booking can come up to `BOOKING_LAG_DAYS` (31)
   after the event: Trading 212 booked a takeover and a special dividend several days late
   (06 §4.3), so the event is taken to fall in [D − 31, D].
   - **Doh-KDVP(Y)** is withheld when X has a sale in Y on or after D − 31 − 30. Any later
     sale of X takes its lots with or without the refused row (FIFO, 04 §4.4), and the 30-day
     rule reads an acquisition 30 days either side of a loss sale (ZDoh-2 art. 97(5), 04 §5.3).
     Losses are not told apart from gains: that would need rates and FIFO, and it errs on the
     side of withholding.
   - A refusal that **gives shares up** also withholds Doh-KDVP of every year from the first
     purchase of X on record up to D, or of every year up to D when none is on record. A
     disposal belongs to the year it happened, and for a merger that can be months before the
     booking: one reading dates it by the merger agreement (04 §9.1, open question).
   - A refusal that **receives rights** also withholds Doh-KDVP(Y) when any security is sold
     in Y between D − 31 − 30 and D + 30: acquiring a right to buy counts as acquiring capital
     of the same kind (art. 97(5)(1), 04 §5.3), and the row names only the right.
   - **Doh-Div(Y)** is withheld by a refusal that receives shares or rights when [D − 31, D]
     overlaps Y: what is received might be income of its year (#29). A sale at 0 is no income.
4. **In a year it cannot change, a refusal shows as a note.** The review, the files step and
   the CLI show the year's view of the ledger's findings (`Prepared.scope.findings`): a scoped
   refusal that withholds neither return becomes `refusedElsewhere` (severity info, same row),
   which names the security, the date and what the row does (a sale at 0, new shares, free
   rights, never text from the file) and says it changes nothing on that year's returns. The
   files step shows each file's findings the same way (`LedgerScope.view`). No row is dropped
   without a word. The ledger keeps the refusal as it was, so the year it belongs to still
   sees it as blocking.
5. **One implementation.** `buildReturns` works the scope out once and hands it to both
   builders, which withhold their form by it; the web engine and the CLI count and show
   findings through `Prepared.scope`. The CLI's exit code is
   non-zero when a finding of the prepared year blocks; a refusal that changes nothing in that
   year no longer makes it fail.

What the rule assumes a scoped refusal does not do, and why each holds:

| Assumption | Why it holds, and what would break it |
|---|---|
| The event is at most 31 days before its booking | Seen: several days (06 §4.3). A longer lag would need a wider margin. |
| A takeover's legs change no other security | Both legs are refused and each reaches its own security; the new shares' value is the old shares' disposal value (04 §9.1). |
| Rights change no other security's cost | No source found gives free rights a basis taken from the parent (#29); the 30-day reach is covered by the rights clause. |
| A refused row hides no dividend of another year | Shares or rights received within a month of the year count for it; `Dividend adjustment`, which can reverse an earlier year, stays unscoped. |
| The ISIN is the engine's identity of a security | True today: ISIN changes are refused and unscoped. Widen this check with the engine when ISINs are linked. |
| A later sale missing the refused shares is caught anyway | `insufficientHistory` blocks it (`packages/furs/src/build-kdvp.ts`). |

This amends ADR 0011 decision 9 ("an adapter's refused row included, withholds both forms") and
ADR 0013 decision 9 ("a finding from reading the files, which can bear on either, withholds
both") for scoped refusals only. ADR 0015's Trade Republic refusals stay unscoped.

## Consequences

- A user whose history holds a takeover paid in shares or free rights gets the returns of every
  year those rows cannot change; the year they belong to still waits for #28 and #29.
- A refused row is shown as a note in the other years, so a 2025 problem stays visible from
  2026 without blocking it.
- The rule is conservative: a gain within the 30-day window, or any sale near free rights,
  still withholds. Narrowing it would take rates and FIFO inside the check.
- Interactive Brokers and Trade Republic refusals, and Trading 212's `Spin off`, `Transfer
  in`/`Transfer out`, `Equity rights` and dividend-type refusals, still withhold everything;
  each needs its own analysis of what it can reach before it is scoped (#52).
- The margin rests on one export's booking lag; research on more exports may widen it (#52).
- `scopeLedger` refuses a tax year outside 2013 to 9999, as the builders do: a malformed year
  would compare as text and scope every refusal away.

## On Acceptance

- [ ] Open issues naming this ADR re-read against the settled decision:
      `python3 scripts/adr-accepted-issue-sweep.py --adr 0017`
- [ ] Any issue carrying pre-ADR scope rewritten (title and body), led by a dated correction
      note. Record the count here, including zero.
