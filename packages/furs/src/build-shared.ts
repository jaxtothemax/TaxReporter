/**
 * What the form builders share.
 *
 * - Banka Slovenije rate lookups, with what they tell the user. A missing
 *   rate blocks: the amount cannot be converted, and no other source may
 *   stand in (CLAUDE.md, "Tax correctness"). A day on which BSI's rate
 *   differs from the ECB's is noted once per list, since the BSI value is
 *   the one used (docs/research/03-bsi-exchange-rates.md).
 * - The writer's validation issues as diagnostics.
 */
import {
  diagnostic,
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
