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
 * - **F10** comes from the 30-day rule: true when the loss may reduce the
 *   base, false when it is replaced, a partly replaced loss split into a
 *   false row and a true row, and left out (with a warning) while the
 *   imported files end inside the 30 days after the sale.
 * - **The estimate** is computed from the rows as written, matched the way
 *   eDavki matches them, so it shows what eDavki will compute.
 * - **No form while anything blocks.** A missing rate or purchase leaves a
 *   list that does not add up, so the form is withheld; the lists and
 *   diagnostics still come back for the review.
 */
import {
  addDays,
  bucketFor,
  completedYears,
  Decimal,
  diagnostic,
  estimateGainsTax,
  hasBlocking,
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
  type Money,
  type SecurityHistory,
  type SourceRef,
  type SplitEvent,
} from "@taxreporter/core";
import type { BsiRate, RateTable } from "@taxreporter/fx";

import type { Taxpayer } from "./common.js";
import type { DohKdvp, KdvpList, KdvpRow } from "./kdvp.js";

export interface KdvpBuildInput {
  readonly taxYear: number;
  readonly taxpayer: Taxpayer;
  readonly events: readonly LedgerEvent[];
  readonly rates: RateTable;
  /**
   * The last day the imported exports cover. The 30-day rule looks 30 days
   * past each loss, so a December loss needs January's trades.
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

const rounded = (value: Decimal) => value.round(QUANTITY_SCALE, "halfUp");

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Whether a FIFO finding bears on the return for the year. One about a
 * later sale, or about a security with no sale in the year, belongs to
 * another year's return and must not block this one; anything in the year,
 * or in the 30 days after it that the 30-day rule reads, stays.
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

/**
 * Matches the list's sale rows to its purchase rows first in, first out,
 * with the per-unit values rounded as written: eDavki's computation.
 */
function simulate(rows: readonly KdvpRow[]): BuiltLot[] {
  const queue: { date: IsoDate; left: Decimal; unit: Decimal }[] = [];
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
      const lot = queue[0];
      if (lot === undefined) break;
      const take = lot.left.lessThan(need) ? lot.left : need;
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
      if (!lot.left.isPositive()) queue.shift();
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

/** Whitespace runs folded to one space; undefined when nothing is left. */
function singleLine(text: string | undefined): string | undefined {
  const folded = text?.replace(/\s+/g, " ").trim();
  return folded === undefined || folded === "" ? undefined : folded;
}

export function buildDohKdvp(input: KdvpBuildInput): KdvpBuild {
  const { taxYear, rates } = input;
  const yearStart = `${String(taxYear)}-01-01`;
  const yearEnd = `${String(taxYear)}-12-31`;
  const fifo = matchFifo(input.events);
  const inYear = (date: IsoDate) => date >= yearStart && date <= yearEnd;
  const sold = new Set(
    [...fifo.securities.values()]
      .filter((h) => h.disposals.some((d) => inYear(d.sale.date)))
      .map((h) => h.isin),
  );
  const diagnostics: Diagnostic[] = fifo.diagnostics.filter((d) =>
    bearsOnYear(d, sold, yearStart, yearEnd),
  );

  // A known BSI-versus-ECB difference is noted once per list, not per row.
  const ecbNoted = new Set<string>();
  const lookup = (
    money: Money,
    date: IsoDate,
    source: SourceRef,
  ): BsiRate | null => {
    const result = rates.lookup(money.currency, date);
    if (result.ok) {
      const { ecbRate, listCurrency, listDate, published } = result.rate;
      const noted = `${listCurrency} ${listDate}`;
      if (ecbRate !== undefined && !ecbNoted.has(noted)) {
        ecbNoted.add(noted);
        diagnostics.push(
          diagnostic("info", "rateDiffersFromEcb", {
            currency: listCurrency,
            date: listDate,
            bsi: published,
            ecb: ecbRate,
          }),
        );
      }
      return result.rate;
    }
    diagnostics.push(
      diagnostic(
        "blocking",
        "rateUnavailable",
        { currency: money.currency, date, reason: result.error },
        source,
      ),
    );
    return null;
  };

  // Lists in ISIN order, so the same input always writes the same file.
  const histories = [...fifo.securities.values()].sort((a, b) =>
    compare(a.isin, b.isin),
  );

  const lists: BuiltList[] = [];
  for (const history of histories) {
    const built = buildList(history);
    if (built !== null) lists.push(built);
  }

  const estimate = estimateGainsTax(lists.flatMap((list) => list.lots));
  const form: DohKdvp | null =
    lists.length === 0 || hasBlocking(diagnostics)
      ? null
      : { taxYear, taxpayer: input.taxpayer, lists: lists.map((l) => l.list) };
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

    // The purchases the year's sales consume, outside the 15-year exemption.
    const consumed = new Map<string, Decimal>();
    const listedSales: { disposal: Disposal; quantity: Decimal }[] = [];
    let exempt = Decimal.ZERO;
    for (const disposal of sales) {
      let listed = Decimal.ZERO;
      for (const match of disposal.matches) {
        const inBasis = match.quantity.times(toBasis(disposal.sale.date));
        if (completedYears(match.purchase.date, disposal.sale.date) >= 15) {
          exempt = exempt.plus(inBasis);
          continue;
        }
        listed = listed.plus(inBasis);
        const key = match.purchase.key;
        consumed.set(key, (consumed.get(key) ?? Decimal.ZERO).plus(inBasis));
      }
      if (listed.isPositive()) listedSales.push({ disposal, quantity: listed });
    }
    if (exempt.isPositive()) {
      diagnostics.push(
        diagnostic("info", "exemptLotsLeftOut", {
          isin,
          quantity: exempt.toPlain(QUANTITY_SCALE, "halfUp"),
        }),
      );
    }
    if (listedSales.length === 0) return null;

    const drafts: DraftRow[] = [];
    /** Each listed purchase's per-unit cost as written, by purchase key. */
    const purchaseUnit = new Map<string, Decimal>();
    for (const purchase of history.purchases) {
      const quantity = consumed.get(purchase.key);
      if (quantity === undefined) continue;
      const rate = lookup(purchase.price, purchase.date, purchase.source);
      if (rate === null) continue;
      const factor = toBasis(purchase.date);
      const unitPrice = purchase.price.amount.dividedBy(factor);
      purchaseUnit.set(
        purchase.key,
        unitPrice.dividedBy(rate.rate).round(UNIT_SCALE, "halfUp"),
      );
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

    const saleUnits = new Map<string, { unit: Decimal; rate: BsiRate }>();
    for (const { disposal } of listedSales) {
      const rate = lookup(
        disposal.sale.price,
        disposal.sale.date,
        disposal.sale.source,
      );
      if (rate === null) continue;
      const unitPrice = disposal.sale.price.amount.dividedBy(
        toBasis(disposal.sale.date),
      );
      saleUnits.set(disposal.sale.key, {
        unit: unitPrice.dividedBy(rate.rate),
        rate,
      });
    }
    // F10 matters only where there is a loss. eDavki takes gains and losses
    // lot by lot (each lot has its own holding period, research 04 §4.6),
    // so a sale needs F10 when any of its listed lots, valued as eDavki will
    // value them, loses money; the 30-day rule then decides it (04 §5.3).
    const lossSales = listedSales
      .filter(({ disposal }) => {
        const sale = saleUnits.get(disposal.sale.key);
        if (sale === undefined) return false;
        const value = sale.unit.round(UNIT_SCALE, "halfUp");
        return disposal.matches.some((match) => {
          if (completedYears(match.purchase.date, disposal.sale.date) >= 15)
            return false;
          const cost = purchaseUnit.get(match.purchase.key);
          if (cost === undefined) return false;
          const quantity = match.quantity.times(toBasis(disposal.sale.date));
          return quantity
            .times(value)
            .round(2, "halfUp")
            .lessThan(quantity.times(cost).round(2, "halfUp"));
        });
      })
      .map(({ disposal }) => disposal);
    const verdicts = washSaleVerdicts(history, lossSales, input.coverageEnd);
    const losses = new Set(lossSales.map((d) => d.sale.key));

    for (const { disposal, quantity } of listedSales) {
      const sale = disposal.sale;
      const unit = saleUnits.get(sale.key);
      if (unit === undefined) continue;
      const factor = toBasis(sale.date);
      const common = {
        kind: "sale" as const,
        date: sale.date,
        unitEur: unit.unit,
        price: {
          amount: sale.price.amount.dividedBy(factor),
          currency: sale.price.currency,
        },
        rate: unit.rate,
        broker: sale.broker,
        source: sale.source,
        factor,
      };
      if (!losses.has(sale.key)) {
        drafts.push({ ...common, quantity });
        continue;
      }
      const verdict = verdicts.get(sale.key);
      const params = { isin, date: sale.date };
      switch (verdict?.status) {
        case "allowed":
          drafts.push({ ...common, quantity, lossReducesBase: true });
          diagnostics.push(
            diagnostic("info", "lossCounts", params, sale.source),
          );
          break;
        case "disallowed":
          drafts.push({ ...common, quantity, lossReducesBase: false });
          diagnostics.push(
            diagnostic("info", "lossDisallowed", params, sale.source),
          );
          break;
        case "partial": {
          // The replaced part first, as its own row: only it loses the
          // deduction. Coming first, it takes the sale's oldest lots, the
          // order eDavki matches rows in; FURS has no rule for which lots
          // carry it (research 04, open questions). The rule counts the
          // whole sale, so with exempt lots left off the replaced part can
          // cover all that is listed.
          const all = verdict.replaced.times(factor);
          const replaced = all.lessThan(quantity) ? all : quantity;
          drafts.push({
            ...common,
            quantity: replaced,
            lossReducesBase: false,
          });
          const rest = quantity.minus(replaced);
          if (rest.isPositive()) {
            drafts.push({ ...common, quantity: rest, lossReducesBase: true });
          }
          diagnostics.push(
            diagnostic(
              "info",
              "lossPartlyDisallowed",
              {
                ...params,
                replaced: replaced.toPlain(QUANTITY_SCALE, "halfUp"),
              },
              sale.source,
            ),
          );
          break;
        }
        default:
          drafts.push({ ...common, quantity });
          diagnostics.push(
            diagnostic(
              "warning",
              "washSaleWindowOpen",
              { ...params, until: addDays(sale.date, WASH_SALE_DAYS) },
              sale.source,
            ),
          );
      }
    }

    for (const split of history.splits) {
      if (drafts.some((row) => row.date < split.date && split.date <= basis)) {
        diagnostics.push(
          diagnostic("info", "splitAdjusted", {
            isin,
            ratio: `${split.to.toString()}:${split.from.toString()}`,
            date: split.date,
          }),
        );
      }
    }

    // Date order, purchases before sales on the same day (FIFO can then use
    // a same-day purchase), each kind in its own order.
    const ordered = drafts
      .map((row, index) => ({ row, index }))
      .sort(
        (a, b) =>
          compare(a.row.date, b.row.date) ||
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

    // Broker names can carry tabs, line breaks or padding, which the form
    // refuses; they are folded to single spaces and cut to the form's limits.
    const security = history.security;
    const ticker = singleLine(security.symbol);
    const name = singleLine(security.name) ?? ticker ?? isin;
    const list: KdvpList = {
      isin,
      ...(ticker === undefined ? {} : { ticker: truncate(ticker, 10) }),
      name: truncate(name, 100),
      isFund: security.isFund === true,
      rows: rows.map((r) => r.row),
    };
    return { list, rows, lots: simulate(list.rows) };
  }
}
