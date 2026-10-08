/**
 * Builds the Doh-KDVP return from ledger events: the inventory list of each
 * security sold in the tax year, its F10 column, and the tax estimate.
 *
 * Choices, and why (docs/research/01-furs-doh-kdvp.md §8, 04 §4–§5):
 *
 * - **Matched lots.** A list holds the purchases, or parts of purchases,
 *   that the year's sales consume, whatever year they were bought in, and
 *   the year's sales; its stock ends at zero. That is how FURS prefills
 *   from domestic brokers.
 * - **Lots held 15 years or more are left off**, and the sale row carries
 *   only the rest of the sale: such disposals are exempt and the
 *   instructions start a list at the first purchase sold within 15 years.
 * - **One share basis per list.** Rows before a split are restated in the
 *   shares of the year's last sale (quantity times the ratio, price divided
 *   by it), with the original dates kept.
 * - **Per-unit values** are the contract price converted at the BSI rate of
 *   the row's own date, without commission (normed costs cover costs); the
 *   writer rounds them half up to 8 decimals.
 * - **Quantities** are rounded to 8 decimals on the running total, so F8 is
 *   always the rounded true stock and never drifts below zero.
 * - **F10, lot by lot.** eDavki takes gains and losses per matched lot (each
 *   has its own holding period, 04 §4.6), so a sale is written as runs of
 *   rows in the order its lots are matched: lots sold at a gain (no F10),
 *   then for lots sold at a loss, the part the 30-day rule disallows (F10
 *   false) and the part that may reduce the base (true). The rule counts
 *   only the shares sold at a loss (04 §5.3), and the disallowed part is
 *   taken from the sale's first loss lots, an assumption FURS has not ruled
 *   on (04, open questions). While the files end inside the 30 days after a
 *   loss, its open part is left without F10, with a warning.
 * - **Losses of the weeks before the year count too**: a purchase that
 *   replaced a December loss cannot replace a January one as well.
 * - **The estimate** is computed from the rows as written, matched the way
 *   eDavki matches them, so it shows what eDavki will compute.
 * - **Names are cleaned, never refused.** A broker's names can carry
 *   characters the form refuses; they become spaces (`toPlainLine`), and
 *   two securities sharing a name get their ISIN after it, since the schema
 *   means names to be unique.
 * - **No form while anything blocks.** A missing rate or purchase leaves a
 *   list that does not add up, so the form is withheld; the lists and
 *   diagnostics still come back for the review. A form handed out has also
 *   passed the writer's own rules.
 */
import {
  addDays,
  bucketFor,
  compareText,
  completedYears,
  Decimal,
  diagnostic,
  estimateGainsTax,
  hasBlocking,
  isIsoDate,
  lotBase,
  matchFifo,
  washSaleVerdicts,
  WASH_SALE_DAYS,
  type Diagnostic,
  type Disposal,
  type GainsEstimate,
  type HoldingBucket,
  type IsoDate,
  type LedgerEvent,
  type LossSale,
  type LotMatch,
  type Money,
  type SecurityHistory,
  type SourceRef,
  type SplitEvent,
  type TradeEvent,
} from "@taxreporter/core";
import type { BsiRate, RateTable } from "@taxreporter/fx";

import { isTaxYear, toPlainLine, type Taxpayer } from "./common.js";
import {
  validateDohKdvp,
  type DohKdvp,
  type KdvpList,
  type KdvpRow,
} from "./kdvp.js";

export interface KdvpBuildInput {
  readonly taxYear: number;
  readonly taxpayer: Taxpayer;
  readonly events: readonly LedgerEvent[];
  readonly rates: RateTable;
  /**
   * The last day every imported account's exports cover: the earliest of
   * their ends. The 30-day rule looks 30 days past each loss, so a December
   * loss needs January's trades, and one account whose files end early
   * could hide a replacement.
   */
  readonly coverageEnd: IsoDate;
}

/** A row of a built list, with what the review shows about it. */
export interface BuiltRow {
  readonly row: KdvpRow;
  /** The price per unit as traded, restated for splits like the row. */
  readonly price: Money;
  readonly rate: BsiRate;
  readonly broker: string;
  readonly source: SourceRef;
  /** Set when a split after the trade restated the row: shares per traded share. */
  readonly splitFactor?: Decimal;
}

/** A sale matched to a purchase the way eDavki matches the list's rows. */
export interface BuiltLot {
  readonly purchaseDate: IsoDate;
  readonly saleDate: IsoDate;
  readonly quantity: Decimal;
  /** Rounded to cents, as eDavki computes them from the per-unit fields. */
  readonly acquisitionEur: Decimal;
  readonly disposalEur: Decimal;
  readonly gainEur: Decimal;
  readonly normedCostsEur: Decimal;
  readonly yearsHeld: number;
  readonly bucket: HoldingBucket;
  readonly lossReducesBase: boolean;
}

export interface BuiltList {
  readonly list: KdvpList;
  readonly rows: readonly BuiltRow[];
  readonly lots: readonly BuiltLot[];
}

export interface KdvpBuild {
  /**
   * Null when nothing taxable was sold in the year (there is no Doh-KDVP to
   * file), or while a blocking diagnostic stands.
   */
  readonly form: DohKdvp | null;
  readonly lists: readonly BuiltList[];
  readonly estimate: GainsEstimate;
  readonly diagnostics: readonly Diagnostic[];
}

const QUANTITY_SCALE = 8;
const UNIT_SCALE = 8;
const NAME_LENGTH = 100;
const TICKER_LENGTH = 10;

const rounded = (value: Decimal) => value.round(QUANTITY_SCALE, "halfUp");
const lesser = (a: Decimal, b: Decimal) => (a.lessThan(b) ? a : b);

/**
 * Whether a FIFO finding bears on the return for the year. One about a
 * later sale, or about a security with no sale in the year, belongs to
 * another year's return and must not block this one; anything in the year,
 * or in the 30 days after it that the 30-day rule reads, stays. A finding
 * without a valid ISIN or date is never dropped.
 */
function bearsOnYear(
  finding: Diagnostic,
  sold: ReadonlySet<string>,
  yearStart: IsoDate,
  yearEnd: IsoDate,
): boolean {
  const { isin, date } = finding.params;
  if (isin === undefined || date === undefined) return true;
  if (date > addDays(yearEnd, WASH_SALE_DAYS)) return false;
  if (finding.code === "insufficientHistory" && date > yearEnd) return false;
  return (date >= yearStart && date <= yearEnd) || sold.has(isin);
}

/** Shares as of `to` per share as of `from`, for the splits in between. */
function splitFactor(
  splits: readonly SplitEvent[],
  from: IsoDate,
  to: IsoDate,
): Decimal {
  let factor = Decimal.ONE;
  for (const split of splits) {
    if (from < split.date && split.date <= to) {
      factor = factor.times(split.to.dividedBy(split.from));
    }
  }
  return factor;
}

interface DraftRow {
  readonly kind: "purchase" | "sale";
  readonly date: IsoDate;
  /** Exact, in the list's share basis. */
  readonly quantity: Decimal;
  readonly unitEur: Decimal;
  readonly price: Money;
  readonly rate: BsiRate;
  readonly broker: string;
  readonly source: SourceRef;
  readonly factor: Decimal;
  readonly lossReducesBase?: boolean;
}

/** A lot a sale consumed, as gain or loss, in shares of the valuation basis. */
interface ValuedMatch {
  readonly match: LotMatch;
  /** In shares of the basis the sale was valued in. */
  readonly quantity: Decimal;
  readonly loss: boolean;
}

/**
 * Matches the list's sale rows to its purchase rows first in, first out,
 * with the per-unit values rounded as written: eDavki's computation.
 */
function simulate(rows: readonly KdvpRow[]): BuiltLot[] {
  const queue: { date: IsoDate; left: Decimal; unit: Decimal }[] = [];
  let head = 0;
  const lots: BuiltLot[] = [];
  for (const row of rows) {
    if (row.kind === "purchase") {
      queue.push({
        date: row.date,
        left: row.quantity,
        unit: row.unitCostEur.round(UNIT_SCALE, "halfUp"),
      });
      continue;
    }
    const unit = row.unitValueEur.round(UNIT_SCALE, "halfUp");
    let need = row.quantity;
    while (need.isPositive()) {
      const lot = queue[head];
      if (lot === undefined) break;
      const take = lesser(lot.left, need);
      const acquisitionEur = take.times(lot.unit).round(2, "halfUp");
      const disposalEur = take.times(unit).round(2, "halfUp");
      const yearsHeld = completedYears(lot.date, row.date);
      const bucket = bucketFor(yearsHeld);
      // An undetermined F10 is left out of the file, and eDavki shows an
      // absent F10 as "Ne": the estimate assumes the same.
      const lossReducesBase = row.lossReducesBase === true;
      const base = lotBase({
        bucket,
        acquisitionEur,
        disposalEur,
        lossReducesBase,
      });
      lots.push({
        purchaseDate: lot.date,
        saleDate: row.date,
        quantity: take,
        acquisitionEur,
        disposalEur,
        gainEur: base.gain,
        normedCostsEur: base.normedCosts,
        yearsHeld,
        bucket,
        lossReducesBase,
      });
      need = need.minus(take);
      lot.left = lot.left.minus(take);
      if (!lot.left.isPositive()) head += 1;
    }
  }
  return lots;
}

/**
 * The first `length` characters (code points, as the schema counts them),
 * never splitting a surrogate pair; trailing space a cut exposes is dropped.
 */
function truncate(text: string, length: number): string {
  let end = 0;
  for (let count = 0; count < length && end < text.length; count += 1) {
    const unit = text.charCodeAt(end);
    end += unit >= 0xd800 && unit <= 0xdbff ? 2 : 1;
  }
  return text.slice(0, end).trimEnd();
}

type RunKind = "gain" | "disallowed" | "allowed" | "open";

/** F10 for each kind of run: none on a gain or an open loss. */
const RUN_F10: Readonly<Record<RunKind, boolean | undefined>> = {
  gain: undefined,
  disallowed: false,
  allowed: true,
  open: undefined,
};

export function buildDohKdvp(input: KdvpBuildInput): KdvpBuild {
  const { taxYear, rates } = input;
  // The caller's own inputs: a malformed year or date would compare as text
  // and quietly decide what is listed and which losses count.
  if (!isTaxYear(taxYear)) {
    throw new RangeError("taxYear must be a whole year from 2013");
  }
  if (!isIsoDate(input.coverageEnd)) {
    throw new RangeError("coverageEnd must be an ISO date (YYYY-MM-DD)");
  }
  const yearStart = `${String(taxYear)}-01-01`;
  const yearEnd = `${String(taxYear)}-12-31`;
  // Dividends are Doh-Div's; anything else, unknown kinds included, goes to
  // the engine, which refuses what it cannot use.
  const fifo = matchFifo(
    input.events.filter(
      (e) => e.kind !== "dividend" && e.kind !== "withholding",
    ),
  );
  const inYear = (date: IsoDate) => date >= yearStart && date <= yearEnd;
  const sold = new Set(
    [...fifo.securities.values()]
      .filter((h) => h.disposals.some((d) => inYear(d.sale.date)))
      .map((h) => h.isin),
  );
  const diagnostics: Diagnostic[] = fifo.diagnostics.filter((d) =>
    bearsOnYear(d, sold, yearStart, yearEnd),
  );

  // One lookup per trade, so a missing rate is reported once, and a known
  // BSI-versus-ECB difference once per list.
  const ecbNoted = new Set<string>();
  const rateCache = new Map<TradeEvent, BsiRate | null>();
  const rateOf = (trade: TradeEvent): BsiRate | null => {
    const cached = rateCache.get(trade);
    if (cached !== undefined) return cached;
    const result = rates.lookup(trade.price.currency, trade.date);
    let rate: BsiRate | null = null;
    if (result.ok) {
      rate = result.rate;
      const { ecbRate, listCurrency, listDate, published } = result.rate;
      const list = `${listCurrency} ${listDate}`;
      if (ecbRate !== undefined && !ecbNoted.has(list)) {
        ecbNoted.add(list);
        diagnostics.push(
          diagnostic("info", "rateDiffersFromEcb", {
            currency: listCurrency,
            date: listDate,
            bsi: published,
            ecb: ecbRate,
          }),
        );
      }
    } else {
      diagnostics.push(
        diagnostic(
          "blocking",
          "rateUnavailable",
          {
            currency: trade.price.currency,
            date: trade.date,
            reason: result.error,
          },
          trade.source,
        ),
      );
    }
    rateCache.set(trade, rate);
    return rate;
  };

  // Lists in ISIN order, so the same input always writes the same file.
  const histories = [...fifo.securities.values()].sort((a, b) =>
    compareText(a.isin, b.isin),
  );
  const built: BuiltList[] = [];
  for (const history of histories) {
    const list = buildList(history);
    if (list !== null) built.push(list);
  }

  // The schema means list names to be unique; a repeated one gets the ISIN.
  const uses = new Map<string, number>();
  for (const { list } of built) {
    uses.set(list.name, (uses.get(list.name) ?? 0) + 1);
  }
  const lists = built.map((b) =>
    (uses.get(b.list.name) ?? 0) < 2
      ? b
      : {
          ...b,
          list: {
            ...b.list,
            name: `${truncate(b.list.name, NAME_LENGTH - 15)} (${b.list.isin})`,
          },
        },
  );

  const estimate = estimateGainsTax(lists.flatMap((list) => list.lots));
  const draft: DohKdvp = {
    taxYear,
    taxpayer: input.taxpayer,
    lists: lists.map((l) => l.list),
  };
  // The writer's own rules, run here so that a form handed out is one the
  // writer takes. Only when nothing else blocks: a missing rate or purchase
  // leaves lists that break them too, and the review should show the cause.
  if (lists.length > 0 && !hasBlocking(diagnostics)) {
    for (const issue of validateDohKdvp(draft)) {
      diagnostics.push(
        diagnostic("blocking", "formIssue", {
          code: issue.code,
          path: issue.path,
        }),
      );
    }
  }
  const form = lists.length === 0 || hasBlocking(diagnostics) ? null : draft;
  return { form, lists, estimate, diagnostics };

  function buildList(history: SecurityHistory): BuiltList | null {
    const sales = history.disposals.filter((d) => inYear(d.sale.date));
    if (sales.length === 0) return null;
    const isin = history.isin;
    const basis = sales.reduce(
      (last, d) => (d.sale.date > last ? d.sale.date : last),
      yearStart,
    );
    const toBasis = (date: IsoDate) => splitFactor(history.splits, date, basis);

    /** A trade's EUR per share of `basisDate`, as the form writes it. */
    const unitIn = (trade: TradeEvent, basisDate: IsoDate): Decimal | null => {
      const rate = rateOf(trade);
      if (rate === null) return null;
      return trade.price.amount
        .dividedBy(splitFactor(history.splits, trade.date, basisDate))
        .dividedBy(rate.rate)
        .round(UNIT_SCALE, "halfUp");
    };

    /**
     * A sale's lots in match order, each a gain or a loss as eDavki will
     * value it (cents of the per-unit values as written), in shares of
     * `basisDate`. Exempt lots are left out; null when a rate is missing.
     */
    const valued = (
      disposal: Disposal,
      basisDate: IsoDate,
    ): ValuedMatch[] | null => {
      const value = unitIn(disposal.sale, basisDate);
      if (value === null) return null;
      const factor = splitFactor(history.splits, disposal.sale.date, basisDate);
      const out: ValuedMatch[] = [];
      for (const match of disposal.matches) {
        if (completedYears(match.purchase.date, disposal.sale.date) >= 15) {
          continue;
        }
        const cost = unitIn(match.purchase, basisDate);
        if (cost === null) return null;
        const quantity = match.quantity.times(factor);
        const loss = quantity
          .times(value)
          .round(2, "halfUp")
          .lessThan(quantity.times(cost).round(2, "halfUp"));
        out.push({ match, quantity, loss });
      }
      return out;
    };
    const lossShares = (lots: readonly ValuedMatch[]) =>
      Decimal.sum(lots.filter((v) => v.loss).map((v) => v.match.quantity));

    // The purchases the year's sales consume, outside the 15-year exemption.
    const consumed = new Map<TradeEvent, Decimal>();
    const listed: { disposal: Disposal; lots: ValuedMatch[] | null }[] = [];
    let exempt = Decimal.ZERO;
    for (const disposal of sales) {
      let shares = Decimal.ZERO;
      for (const match of disposal.matches) {
        const inBasis = match.quantity.times(toBasis(disposal.sale.date));
        if (completedYears(match.purchase.date, disposal.sale.date) >= 15) {
          exempt = exempt.plus(inBasis);
          continue;
        }
        shares = shares.plus(inBasis);
        consumed.set(
          match.purchase,
          (consumed.get(match.purchase) ?? Decimal.ZERO).plus(inBasis),
        );
      }
      if (shares.isPositive()) {
        listed.push({ disposal, lots: valued(disposal, basis) });
      }
    }
    if (exempt.isPositive()) {
      diagnostics.push(
        diagnostic("info", "exemptLotsLeftOut", {
          isin,
          quantity: exempt.toPlain(QUANTITY_SCALE, "halfUp"),
        }),
      );
    }
    if (listed.length === 0) return null;

    // The 30-day rule, over this year's losses and those of the weeks just
    // before it, whose replacements this year's losses cannot use again.
    const lookBack = addDays(yearStart, -2 * WASH_SALE_DAYS - 1);
    const losses: LossSale[] = [];
    for (const disposal of history.disposals) {
      const date = disposal.sale.date;
      if (date < lookBack || date > yearEnd) continue;
      const lots = inYear(date)
        ? (listed.find((l) => l.disposal === disposal)?.lots ?? null)
        : valued(disposal, date);
      if (lots === null) continue;
      const quantity = lossShares(lots);
      if (quantity.isPositive()) losses.push({ disposal, quantity });
    }
    const verdicts = washSaleVerdicts(history, losses, input.coverageEnd);

    const drafts: DraftRow[] = [];
    for (const purchase of history.purchases) {
      const quantity = consumed.get(purchase);
      if (quantity === undefined) continue;
      const rate = rateOf(purchase);
      if (rate === null) continue;
      const factor = toBasis(purchase.date);
      const unitPrice = purchase.price.amount.dividedBy(factor);
      drafts.push({
        kind: "purchase",
        date: purchase.date,
        quantity,
        unitEur: unitPrice.dividedBy(rate.rate),
        price: { amount: unitPrice, currency: purchase.price.currency },
        rate,
        broker: purchase.broker,
        source: purchase.source,
        factor,
      });
    }

    for (const { disposal, lots } of listed) {
      const sale = disposal.sale;
      const rate = rateOf(sale);
      if (rate === null || lots === null) continue;
      const factor = toBasis(sale.date);
      const unitPrice = sale.price.amount.dividedBy(factor);
      const common = {
        kind: "sale" as const,
        date: sale.date,
        unitEur: unitPrice.dividedBy(rate.rate),
        price: { amount: unitPrice, currency: sale.price.currency },
        rate,
        broker: sale.broker,
        source: sale.source,
        factor,
      };

      // Disallowed loss shares, in shares as of the sale date, taken from
      // the sale's first loss lots.
      const verdict = verdicts.get(sale);
      const lost = lossShares(lots);
      let disallow =
        verdict === undefined
          ? Decimal.ZERO
          : verdict.status === "disallowed"
            ? lost
            : lesser(verdict.replaced, lost);
      const runs: { kind: RunKind; quantity: Decimal }[] = [];
      const add = (kind: RunKind, quantity: Decimal) => {
        if (!quantity.isPositive()) return;
        const last = runs.at(-1);
        if (last?.kind === kind) last.quantity = last.quantity.plus(quantity);
        else runs.push({ kind, quantity });
      };
      for (const lot of lots) {
        if (!lot.loss) {
          add("gain", lot.quantity);
          continue;
        }
        const off = lesser(lot.match.quantity, disallow);
        disallow = disallow.minus(off);
        add("disallowed", off.times(factor));
        add(
          verdict?.status === "undetermined" ? "open" : "allowed",
          lot.match.quantity.minus(off).times(factor),
        );
      }
      for (const run of runs) {
        const f10 = RUN_F10[run.kind];
        drafts.push({
          ...common,
          quantity: run.quantity,
          ...(f10 === undefined ? {} : { lossReducesBase: f10 }),
        });
      }

      if (!lost.isPositive() || verdict === undefined) continue;
      const params = { isin, date: sale.date };
      const replaced = runs
        .filter((r) => r.kind === "disallowed")
        .reduce((sum, r) => sum.plus(r.quantity), Decimal.ZERO);
      diagnostics.push(
        verdict.status === "allowed"
          ? diagnostic("info", "lossCounts", params, sale.source)
          : verdict.status === "disallowed"
            ? diagnostic("info", "lossDisallowed", params, sale.source)
            : verdict.status === "partial"
              ? diagnostic(
                  "info",
                  "lossPartlyDisallowed",
                  {
                    ...params,
                    replaced: replaced.toPlain(QUANTITY_SCALE, "halfUp"),
                  },
                  sale.source,
                )
              : diagnostic(
                  "warning",
                  "washSaleWindowOpen",
                  { ...params, until: addDays(sale.date, WASH_SALE_DAYS) },
                  sale.source,
                ),
      );
    }

    for (const split of history.splits) {
      if (drafts.some((row) => row.date < split.date && split.date <= basis)) {
        diagnostics.push(
          diagnostic("info", "splitAdjusted", {
            isin,
            // Whole numbers: the engine refuses any other split term.
            ratio: `${split.to.toFixed(0, "down")}:${split.from.toFixed(0, "down")}`,
            date: split.date,
          }),
        );
      }
    }

    // Date order, purchases before sales on the same day (FIFO can then use
    // a same-day purchase), each kind in its own order: a sale's runs stay
    // together, in the order its lots are matched.
    const ordered = drafts
      .map((row, index) => ({ row, index }))
      .sort(
        (a, b) =>
          compareText(a.row.date, b.row.date) ||
          (a.row.kind === b.row.kind
            ? 0
            : a.row.kind === "purchase"
              ? -1
              : 1) ||
          a.index - b.index,
      )
      .map(({ row }) => row);

    // Quantities to 8 decimals on the running total.
    let stock = Decimal.ZERO;
    let roundedQuantities = false;
    const rows: BuiltRow[] = [];
    for (const draft of ordered) {
      const before = rounded(stock);
      stock =
        draft.kind === "purchase"
          ? stock.plus(draft.quantity)
          : stock.minus(draft.quantity);
      const quantity = rounded(stock).minus(before).abs();
      if (!quantity.isPositive()) {
        diagnostics.push(
          diagnostic(
            "blocking",
            "quantityTooSmall",
            { isin, date: draft.date },
            draft.source,
          ),
        );
        continue;
      }
      if (!quantity.equals(draft.quantity)) roundedQuantities = true;
      const row: KdvpRow =
        draft.kind === "purchase"
          ? {
              kind: "purchase",
              date: draft.date,
              method: "B",
              quantity,
              unitCostEur: draft.unitEur,
            }
          : {
              kind: "sale",
              date: draft.date,
              quantity,
              unitValueEur: draft.unitEur,
              ...(draft.lossReducesBase === undefined
                ? {}
                : { lossReducesBase: draft.lossReducesBase }),
            };
      rows.push({
        row,
        price: draft.price,
        rate: draft.rate,
        broker: draft.broker,
        source: draft.source,
        ...(draft.factor.equals(Decimal.ONE)
          ? {}
          : { splitFactor: draft.factor }),
      });
    }
    if (roundedQuantities) {
      diagnostics.push(diagnostic("info", "quantitiesRounded", { isin }));
    }

    const security = history.security;
    const ticker = toPlainLine(security.symbol);
    const name = toPlainLine(security.name) ?? ticker ?? isin;
    const list: KdvpList = {
      isin,
      ...(ticker === undefined
        ? {}
        : { ticker: truncate(ticker, TICKER_LENGTH) }),
      name: truncate(name, NAME_LENGTH),
      isFund: security.isFund === true,
      rows: rows.map((r) => r.row),
    };
    return { list, rows, lots: simulate(list.rows) };
  }
}
