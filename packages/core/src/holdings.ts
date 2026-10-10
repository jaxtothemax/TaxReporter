/**
 * Each account's own position in each security: the shares it bought less
 * those it sold, restated for the splits up to the account's own last
 * covered day. This is what the broker shows for that account, to check the
 * files against, and not the FIFO lots, which are matched across every
 * account of the taxpayer (ZDoh-2 Art. 103(1); research 04 §4.4): a sale at
 * one broker can consume a lot bought at another, so the two views differ
 * whenever a security is held in two accounts (ADR-0017).
 *
 * Shares moved between accounts are not read yet (#48), so an account they
 * left or entered is off by them; the caller flags such an account.
 */
import { compareText } from "./compare.js";
import { Decimal } from "./decimal.js";
import { splitFactor } from "./fifo.js";
import type { AccountScope, IsoDate, SplitEvent } from "./ledger.js";
import type { ValidatedLedger } from "./validate.js";

export interface AccountPosition {
  readonly account: AccountScope;
  readonly isin: string;
  /**
   * In shares as of the account's last covered day. Negative when its
   * files sell more than they buy: shares moved in, or earlier exports
   * missing.
   */
  readonly quantity: Decimal;
}

/** Past any real date, for an account read to its last event. */
const OPEN_END = "9999-12-31";

/**
 * The non-zero positions, by account and then ISIN. `splits` are each
 * security's splits once, however many accounts reported them (FIFO's
 * merged list): a split changes every holder's shares, whichever broker
 * told of it. `asOf` is each account's last covered day; an account
 * missing from it is read to its last event.
 */
export function accountPositions(
  ledger: ValidatedLedger,
  splits: ReadonlyMap<string, readonly SplitEvent[]>,
  asOf: ReadonlyMap<AccountScope, IsoDate>,
): AccountPosition[] {
  const totals = new Map<AccountScope, Map<string, Decimal>>();
  for (const event of ledger.events) {
    if (event.kind !== "trade") continue;
    const end = asOf.get(event.account) ?? OPEN_END;
    if (event.date > end) continue;
    const isin = event.security.isin;
    // A trade on a split's own day is already in new shares (splitFactor).
    const shares = event.quantity.times(
      splitFactor(splits.get(isin) ?? [], event.date, end),
    );
    let held = totals.get(event.account);
    if (held === undefined) {
      held = new Map();
      totals.set(event.account, held);
    }
    held.set(
      isin,
      (held.get(isin) ?? Decimal.ZERO).plus(
        event.side === "buy" ? shares : shares.negated(),
      ),
    );
  }
  const positions: AccountPosition[] = [];
  for (const [account, held] of totals) {
    for (const [isin, quantity] of held) {
      if (quantity.isZero()) continue;
      positions.push({ account, isin, quantity });
    }
  }
  return positions.sort(
    (a, b) => compareText(a.account, b.account) || compareText(a.isin, b.isin),
  );
}
