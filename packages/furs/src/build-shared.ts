/**
 * What the form builders share.
 *
 * - Banka Slovenije rate lookups, with what they tell the user. A missing
 *   rate blocks: the amount cannot be converted, and no other source may
 *   stand in (CLAUDE.md, "Tax correctness"). A day on which BSI's rate
 *   differs from the ECB's is noted once per list, since the BSI value is
 *   the one used (docs/research/03-bsi-exchange-rates.md).
 * - The writer's validation issues as diagnostics.
 * - The per-unit EUR value Doh-KDVP writes, which the holdings shown beside
 *   the returns use too, so an open lot is costed as its sale will be.
 */
import {
  diagnostic,
  type Decimal,
  type Diagnostic,
  type IsoDate,
  type SourceRef,
} from "@taxreporter/core";
import type { BsiRate, RateTable } from "@taxreporter/fx";

import type { FormIssue } from "./issues.js";

/**
 * The writer's validation issues as blocking diagnostics, so a builder hands
 * out only a form the writer takes. An issue names a code and a path into
 * the form model, never a value.
 */
export function formIssues(issues: readonly FormIssue[]): Diagnostic[] {
  return issues.map((issue) =>
    diagnostic("blocking", "formIssue", { code: issue.code, path: issue.path }),
  );
}

/** The rate for `currency` on `date`, or null after recording why not. */
export type RateLookup = (
  currency: string,
  date: IsoDate,
  source: SourceRef,
) => BsiRate | null;

/** A lookup over `rates` that records its findings in `diagnostics`. */
export function rateLookup(
  rates: RateTable,
  diagnostics: Diagnostic[],
): RateLookup {
  const noted = new Set<string>();
  return (currency, date, source) => {
    const result = rates.lookup(currency, date);
    if (!result.ok) {
      diagnostics.push(
        diagnostic(
          "blocking",
          "rateUnavailable",
          { currency, date, reason: result.error },
          source,
        ),
      );
      return null;
    }
    const { ecbRate, listCurrency, listDate, published } = result.rate;
    const list = `${listCurrency} ${listDate}`;
    if (ecbRate !== undefined && !noted.has(list)) {
      noted.add(list);
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
  };
}

/** Decimals of a per-unit EUR value on Doh-KDVP (F4, F9). */
export const UNIT_SCALE = 8;

/**
 * A trade's EUR per share of a later share basis, as the form writes it: the
 * contract price, without commission, divided by the splits since the trade
 * (`factor`) and converted at the BSI rate of the trade's own date (ZDoh-2
 * Art. 98(9); docs/research/04-si-tax-rules.md §4.2, §6), rounded half up to
 * the form's 8 decimals.
 */
export function unitValueEur(
  price: Decimal,
  factor: Decimal,
  rate: BsiRate,
): Decimal {
  return price
    .dividedBy(factor)
    .dividedBy(rate.rate)
    .round(UNIT_SCALE, "halfUp");
}
