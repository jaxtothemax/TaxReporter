/**
 * The shares still held, shown beside the returns (ADR-0017, #47), in two
 * views that answer different questions:
 *
 * - **Open lots, across accounts.** FIFO runs per ISIN over every account of
 *   the taxpayer (ZDoh-2 Art. 103(1); research 04 §4.4), so the lots a next
 *   sale will consume are the open FIFO lots, wherever they were bought.
 *   Each is costed as the form will cost it (`unitValueEur`): the contract
 *   price at the BSI rate of its purchase date, without commission (04
 *   §4.2), and with no disallowed loss added, since the 30-day rule leaves
 *   acquisition values alone (04 §5.3).
 * - **Positions, per account.** What each broker shows for each account, to
 *   check the files against: quantities only, since a broker's own cost
 *   basis is not FIFO's.
 *
 * As-of days: an account's positions are as of its own last covered day. A
 * security's lots are as of the earliest last covered day among the
 * accounts that still hold it, since after that day one of them may have
 * traded it unseen; an old, closed account does not hold them back. Never
 * today's date: the files are all there is. A day past the rates snapshot
 * counts only as far as the account's own trades reach, as for the
 * coverage end (prepare.ts): a deposit dated 2099 must not make every lot
 * look fifteen years old.
 *
 * Holdings never block. They raise no diagnostic (the FIFO runs' own are the
 * returns' to raise), and a lot whose rate the snapshot does not have, one
 * bought after it ends, say, is shown without a cost rather than
 * withholding a return. Account scopes stay in here: what goes out names an
 * account by its broker and a number, since an IBKR scope is a hash of a
 * short account ID.
 */
import {
  accountPositions,
  compareText,
  Decimal,
  holdingOutlook,
  isIsoDate,
  matchFifo,
  type AccountScope,
  type FileId,
  type HoldingOutlook,
  type IsoDate,
  type Money,
  type SecurityRef,
  type SourceRef,
  type SplitEvent,
  type ValidatedLedger,
} from "@taxreporter/core";
import { unitValueEur } from "@taxreporter/furs";
import type { BsiRate, RateError, RateTable } from "@taxreporter/fx";

/** An account as it is shown: its broker and its number at that broker. */
export interface AccountLabel {
  /** "ibkr-1": unique in the session, and nothing of the account in it. */
  readonly key: string;
  readonly broker: string;
  /** From 1, per broker, the account with the earliest event first. */
  readonly ordinal: number;
}

export interface AccountPositionRow {
  readonly isin: string;
  readonly security: SecurityRef;
  /** Signed, in shares as of the account's `asOf`. */
  readonly quantity: Decimal;
}

export interface AccountHoldings {
  readonly label: AccountLabel;
  /** The last day its files cover; null for an account with no dated row. */
  readonly asOf: IsoDate | null;
  /** The files that hold its rows, in the order they were given. */
  readonly files: readonly FileId[];
  /**
   * Its files move shares in or out of it, which are not read yet (#48):
   * its positions may not match the broker's.
   */
  readonly transferred: boolean;
  /** A row of its files was refused, so its positions may be missing it. */
  readonly refusedRows: boolean;
  /** Non-zero positions, by ISIN. */
  readonly positions: readonly AccountPositionRow[];
}

/**
 * One open lot. A reverse split can leave its quantity, price and factor
 * with no finite decimal expansion, on which `Decimal.toString` throws:
 * round them (`toPlain`, `toFixed`) to show them.
 */
export interface HeldLot {
  readonly account: AccountLabel;
  readonly purchaseDate: IsoDate;
  /** In shares as of the security's `asOf`. */
  readonly quantity: Decimal;
  /** Contract price per share as of `asOf`: the price paid over `factor`. */
  readonly price: Money;
  /** Shares as of `asOf` per share purchased: the splits in between. */
  readonly factor: Decimal;
  /** Null when the snapshot has no rate for the purchase date. */
  readonly rate: BsiRate | null;
  /** Why there is no rate, when there is none. */
  readonly missingRate?: RateError;
  /** EUR per share as the form writes it (8 decimals); null without a rate. */
  readonly unitCostEur: Decimal | null;
  /** `quantity` times `unitCostEur`, in cents; null without a rate. */
  readonly costEur: Decimal | null;
  /** The bucket on `asOf` and the next one's date (`holdingOutlook`). */
  readonly outlook: HoldingOutlook;
  readonly source: SourceRef;
}

export interface HeldSecurity {
  readonly isin: string;
  readonly security: SecurityRef;
  /** The day its lots are as of: see the module comment. */
  readonly asOf: IsoDate;
  /** The open lots' shares together. */
  readonly quantity: Decimal;
  /** The lots' costs together; null when any lot has none. */
  readonly costEur: Decimal | null;
  /**
   * The files sell more than they buy by `asOf`: earlier exports are
   * missing, so the lots shown may not be the ones held.
   */
  readonly incomplete: boolean;
  /** Oldest first: the order a sale consumes them. */
  readonly lots: readonly HeldLot[];
}

export interface Holdings {
  /** Every account in the files, by broker and then number. */
  readonly accounts: readonly AccountHoldings[];
  /**
   * By ISIN, every security with open lots, or whose files sell more than
   * they buy.
   */
  readonly securities: readonly HeldSecurity[];
}

/** How far a file reaches for one account it covers, with the file. */
export interface FileReach {
  readonly account: AccountScope;
  readonly lastDate: IsoDate;
  readonly fileId: FileId;
}

export interface HoldingsInput {
  readonly ledger: ValidatedLedger;
  readonly rates: RateTable;
  readonly reach: readonly FileReach[];
}

interface Account {
  readonly scope: AccountScope;
  broker: string | null;
  asOf: IsoDate | null;
  firstEvent: IsoDate | null;
  readonly files: FileId[];
  transferred: boolean;
}

/** A broker's name, as `validateLedger` checks it on every event. */
const BROKER = /^[a-z0-9]{1,32}$/;

const later = (a: IsoDate | null, b: IsoDate): IsoDate =>
  a === null || compareText(b, a) > 0 ? b : a;

/** The holdings over a session's ledger. */
export function buildHoldings(input: HoldingsInput): Holdings {
  const { ledger, rates } = input;
  const accounts = collectAccounts(input, rates.completeThrough);
  const labels = labelAccounts(accounts);

  // Every split once, however many accounts told of it, and each security's
  // name: from FIFO over every event.
  const whole = matchFifo(ledger).securities;
  const splits = new Map<string, readonly SplitEvent[]>(
    [...whole].map(([isin, history]) => [isin, history.splits]),
  );
  const securityOf = (isin: string): SecurityRef =>
    whole.get(isin)?.security ?? { isin };

  const asOf = new Map<AccountScope, IsoDate>();
  for (const account of accounts.values()) {
    if (account.asOf !== null) asOf.set(account.scope, account.asOf);
  }
  const positions = accountPositions(ledger, splits, asOf);
  const positionsOf = new Map<AccountScope, AccountPositionRow[]>();
  for (const p of positions) {
    const row = {
      isin: p.isin,
      security: securityOf(p.isin),
      quantity: p.quantity,
    };
    const list = positionsOf.get(p.account);
    if (list === undefined) positionsOf.set(p.account, [row]);
    else list.push(row);
  }

  // A security's lots are as of the earliest day among its holders.
  const through = new Map<string, IsoDate>();
  for (const { account, isin } of positions) {
    const end = asOf.get(account);
    if (end === undefined) continue;
    const seen = through.get(isin);
    if (seen === undefined || compareText(end, seen) < 0) {
      through.set(isin, end);
    }
  }
  const cut = matchFifo(ledger, { through }).securities;

  const refused = refusedFiles(ledger);
  const accountRows: AccountHoldings[] = [...accounts.values()]
    .map((account) => {
      const label = labels.get(account.scope);
      if (label === undefined) throw new Error("An account has no label");
      return {
        label,
        asOf: account.asOf,
        files: account.files,
        transferred: account.transferred,
        refusedRows: account.files.some((file) => refused.has(file)),
        positions: positionsOf.get(account.scope) ?? [],
      };
    })
    .sort(
      (a, b) =>
        compareText(a.label.broker, b.label.broker) ||
        a.label.ordinal - b.label.ordinal,
    );

  const securities: HeldSecurity[] = [];
  for (const [isin, day] of [...through].sort(([a], [b]) =>
    compareText(a, b),
  )) {
    const history = cut.get(isin);
    const lots = (history?.open ?? []).map((lot): HeldLot => {
      const { purchase } = lot;
      const label = labels.get(purchase.account);
      if (label === undefined) throw new Error("A lot's account has no label");
      const found = rates.lookup(purchase.price.currency, purchase.date);
      const rate = found.ok ? found.rate : null;
      const unitCostEur =
        rate === null
          ? null
          : unitValueEur(purchase.price.amount, lot.factor, rate);
      return {
        account: label,
        purchaseDate: purchase.date,
        quantity: lot.quantity,
        price: {
          amount: purchase.price.amount.dividedBy(lot.factor),
          currency: purchase.price.currency,
        },
        factor: lot.factor,
        rate,
        ...(found.ok ? {} : { missingRate: found.error }),
        unitCostEur,
        // Cents per lot, as eDavki values a matched lot (build-kdvp
        // `simulate`), so a sale of the whole lot costs what is shown.
        costEur:
          unitCostEur === null
            ? null
            : lot.quantity.times(unitCostEur).round(2, "halfUp"),
        outlook: holdingOutlook(purchase.date, day),
        source: purchase.source,
      };
    });
    const incomplete = (history?.disposals ?? []).some((d) =>
      d.unmatched.isPositive(),
    );
    // Held in one account and sold short in another, the shares moved
    // between them: nothing is left to show across accounts.
    if (lots.length === 0 && !incomplete) continue;
    const costs = lots.map((l) => l.costEur);
    securities.push({
      isin,
      security: securityOf(isin),
      asOf: day,
      quantity: Decimal.sum(lots.map((l) => l.quantity)),
      costEur: costs.every((c): c is Decimal => c !== null)
        ? Decimal.sum(costs)
        : null,
      incomplete,
      lots,
    });
  }
  return { accounts: accountRows, securities };
}

/**
 * Every account the files name, by their reach and by every row's account,
 * with the day it is as of: see the module comment.
 */
function collectAccounts(
  input: HoldingsInput,
  completeThrough: IsoDate,
): Map<AccountScope, Account> {
  const accounts = new Map<AccountScope, Account>();
  const get = (scope: AccountScope): Account => {
    let account = accounts.get(scope);
    if (account === undefined) {
      account = {
        scope,
        broker: null,
        asOf: null,
        firstEvent: null,
        files: [],
        transferred: false,
      };
      accounts.set(scope, account);
    }
    return account;
  };
  const addFile = (account: Account, file: FileId) => {
    if (!account.files.includes(file)) account.files.push(file);
  };
  for (const reach of input.reach) {
    const account = get(reach.account);
    addFile(account, reach.fileId);
    // An adapter's date is checked here too, as for coverage.
    if (isIsoDate(reach.lastDate)) {
      account.asOf = later(account.asOf, reach.lastDate);
    }
  }
  // Ignored rows count too: an account whose files only moved shares out
  // is still one to show, with its flag.
  for (const event of input.ledger.events) {
    const account = get(event.account);
    account.broker ??= event.broker;
    addFile(account, event.source.fileId);
    if (event.kind === "ignored") {
      if (event.reason === "securitiesTransfer") account.transferred = true;
      continue;
    }
    if (
      account.firstEvent === null ||
      compareText(event.date, account.firstEvent) < 0
    ) {
      account.firstEvent = event.date;
    }
  }
  const lastEvent = new Map<AccountScope, IsoDate>();
  const lastMove = new Map<AccountScope, IsoDate>();
  for (const event of input.ledger.events) {
    if (event.kind === "ignored") continue;
    const scope = event.account;
    lastEvent.set(scope, later(lastEvent.get(scope) ?? null, event.date));
    if (event.kind === "trade" || event.kind === "split") {
      lastMove.set(scope, later(lastMove.get(scope) ?? null, event.date));
    }
  }
  for (const account of accounts.values()) {
    // Without a reach (a hand-built ledger), an account covers its events.
    account.asOf ??= lastEvent.get(account.scope) ?? null;
    const cap = later(lastMove.get(account.scope) ?? null, completeThrough);
    if (account.asOf !== null && compareText(account.asOf, cap) > 0) {
      account.asOf = cap;
    }
  }
  return accounts;
}

/**
 * Numbers each broker's accounts from 1, the one with the earliest event
 * first, and one with no dated event after those; ties by scope, so the
 * same files are always numbered alike, whatever order they came in.
 */
function labelAccounts(
  accounts: ReadonlyMap<AccountScope, Account>,
): Map<AccountScope, AccountLabel> {
  const byBroker = new Map<string, Account[]>();
  for (const account of accounts.values()) {
    // A scope is "broker:label" (core `accountScope`, `accountGroup`); an
    // account known only by a reach takes the prefix if it is a broker's
    // name as validateLedger checks one, so no part of a hash can pass.
    const colon = account.scope.indexOf(":");
    const prefix = colon > 0 ? account.scope.slice(0, colon) : "";
    const broker = account.broker ?? (BROKER.test(prefix) ? prefix : "unknown");
    const list = byBroker.get(broker);
    if (list === undefined) byBroker.set(broker, [account]);
    else list.push(account);
  }
  const labels = new Map<AccountScope, AccountLabel>();
  for (const [broker, list] of byBroker) {
    list.sort(
      (a, b) =>
        (a.firstEvent === null ? 1 : 0) - (b.firstEvent === null ? 1 : 0) ||
        compareText(a.firstEvent ?? "", b.firstEvent ?? "") ||
        compareText(a.scope, b.scope),
    );
    list.forEach((account, i) => {
      const ordinal = i + 1;
      labels.set(account.scope, {
        key: `${broker}-${String(ordinal)}`,
        broker,
        ordinal,
      });
    });
  }
  return labels;
}

/** The files a blocking finding of the ledger points into. */
function refusedFiles(ledger: ValidatedLedger): Set<FileId> {
  const files = new Set<FileId>();
  for (const d of ledger.diagnostics) {
    if (d.severity === "blocking" && d.source !== undefined) {
      files.add(d.source.fileId);
    }
  }
  return files;
}
