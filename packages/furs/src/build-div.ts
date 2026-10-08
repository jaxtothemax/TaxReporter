/**
 * Builds the Doh-Div return from ledger events: one record per dividend paid
 * in the tax year, with its foreign tax, and the tax estimate.
 *
 * Choices, and why (docs/research/02-furs-doh-div-and-others.md §3.4–§6,
 * 04 §7):
 *
 * - **One record per payment**, never summed: FURS rejects merged payments
 *   (02 §5). Tax withheld joins its dividend by the dividend's key, never by
 *   date or amount, and a reversal nets against what it reverses.
 * - **EUR at the BSI rate of the payment date**, for the gross amount and the
 *   foreign tax alike, whatever day the tax was booked (02 §3.4).
 * - **Type 4 for fund units, 1 for shares** (02 §4.1).
 * - **The source country is the ISIN's prefix**, unless the payer's details
 *   give one: prefixes such as XS and EU name no country (02 §3.4).
 * - **Payer details come from the caller.** Broker exports name the security
 *   but not the payer's address or tax ID. A foreign payer without an ID gets
 *   the ISIN in its place, which eDavki accepts (02 §5).
 * - **One payer ID twice on one day** is a critical error in eDavki, so
 *   those records are numbered 1, 2, … instead, FURS's own workaround (02 §5).
 * - **No ReliefStatement.** FURS frames it as a claim to a treaty exemption,
 *   while a resident gets a credit, so it is left to the user's explicit
 *   choice (02 §6).
 * - **No form while anything blocks**; the dividends still come back for the
 *   review.
 */
import {
  Decimal,
  deduplicate,
  diagnostic,
  dividendCredit,
  DIVIDEND_TAX_RATE,
  hasBlocking,
  treatyDividendRate,
  type Diagnostic,
  type DividendCredit,
  type DividendEvent,
  type IsoDate,
  type Money,
  type LedgerEvent,
  type SecurityRef,
  type SourceRef,
  type WithholdingEvent,
} from "@taxreporter/core";
import type { BsiRate, RateTable } from "@taxreporter/fx";

import type { Taxpayer } from "./common.js";
import { fursCountryFromIso, type FursCountry } from "./countries.js";
import {
  validateDohDiv,
  type DividendPayer,
  type DividendRecord,
  type DohDiv,
} from "./div.js";
import { formIssues, rateLookup } from "./build-shared.js";

/** A dividend payer as the caller knows it. */
export interface PayerInfo extends DividendPayer {
  /** The income's source country, where the ISIN's prefix does not give it. */
  readonly sourceCountry?: FursCountry;
}

export interface DivBuildInput {
  readonly taxYear: number;
  readonly taxpayer: Taxpayer;
  readonly events: readonly LedgerEvent[];
  readonly rates: RateTable;
  /** Who pays each security's dividends, by ISIN. */
  readonly payers: ReadonlyMap<string, PayerInfo>;
  /**
   * Treaty caps for countries the built-in table lacks, by FURS country
   * code, as the user states them. They change the estimate only, never the
   * return: eDavki applies the caps itself.
   */
  readonly treatyRates?: ReadonlyMap<string, Decimal>;
}

/** A dividend of the year, with what the review shows about it. */
export interface BuiltDividend {
  /** The record as written, or null while its payer or source is unknown. */
  readonly record: DividendRecord | null;
  readonly date: IsoDate;
  readonly security: SecurityRef;
  readonly gross: Money;
  /** The tax withheld on it, as booked; a reversal is negative. */
  readonly withholdings: readonly Money[];
  readonly rate: BsiRate;
  readonly broker: string;
  readonly source: SourceRef;
  /** In cents, as written. */
  readonly grossEur: Decimal;
  /** In cents, as written; zero when nothing was withheld. */
  readonly foreignTaxEur: Decimal;
  readonly sourceCountry: FursCountry | null;
  /** The treaty cap the credit used, or null when none applied. */
  readonly treatyRate: Decimal | null;
  readonly credit: DividendCredit;
}

export interface DividendsEstimate {
  /** The Slovenian rate, 25%. */
  readonly taxRate: Decimal;
  readonly grossEur: Decimal;
  readonly foreignTaxEur: Decimal;
  readonly creditEur: Decimal;
  /** The Slovenian tax less the credits, payment by payment. */
  readonly taxDueEur: Decimal;
}

export interface DivBuild {
  /**
   * Null when no dividend was paid in the year (there is no Doh-Div to
   * file), or while a blocking diagnostic stands.
   */
  readonly form: DohDiv | null;
  readonly dividends: readonly BuiltDividend[];
  readonly estimate: DividendsEstimate;
  readonly diagnostics: readonly Diagnostic[];
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const cents = (value: Decimal) => value.round(2, "halfUp");

/** A payer ID as eDavki compares it: case and spacing aside. */
const idKey = (id: string) => id.replace(/\s+/g, "").toUpperCase();

export function buildDohDiv(input: DivBuildInput): DivBuild {
  const year = `${String(input.taxYear)}-`;
  const inYear = (date: IsoDate) => date.startsWith(year);

  const { events, diagnostics: dedup } = deduplicate(
    input.events.filter(
      (e) => e.kind === "dividend" || e.kind === "withholding",
    ),
  );
  const diagnostics: Diagnostic[] = [...dedup];
  const lookup = rateLookup(input.rates, diagnostics);

  const dividends = new Map<string, DividendEvent>();
  for (const event of events) {
    if (event.kind === "dividend") dividends.set(event.key, event);
  }
  const withheld = new Map<string, WithholdingEvent[]>();
  for (const event of events) {
    if (event.kind !== "withholding") continue;
    const dividend = dividends.get(event.dividendKey);
    // Each finding is reported by the return of the year it was booked in.
    if (dividend === undefined) {
      if (inYear(event.date)) {
        diagnostics.push(
          diagnostic(
            "blocking",
            "withholdingWithoutDividend",
            { isin: event.isin, date: event.date },
            event.source,
          ),
        );
      }
    } else if (event.isin !== dividend.security.isin) {
      // The key and the security disagree: the adapter is wrong, not the data.
      diagnostics.push(
        diagnostic(
          "blocking",
          "withholdingIsinMismatch",
          { isin: event.isin, date: event.date },
          event.source,
        ),
      );
    } else if (!inYear(dividend.date)) {
      // A reversal of an earlier year's tax changes that year's return.
      if (inYear(event.date)) {
        diagnostics.push(
          diagnostic(
            "warning",
            "withholdingForOtherYear",
            { isin: event.isin, date: event.date, dividendDate: dividend.date },
            event.source,
          ),
        );
      }
    } else {
      withheld.set(dividend.key, [
        ...(withheld.get(dividend.key) ?? []),
        event,
      ]);
    }
  }

  const paid = [...dividends.values()]
    .filter((d) => inYear(d.date))
    .sort(
      (a, b) =>
        compare(a.date, b.date) ||
        compare(a.security.isin, b.security.isin) ||
        compare(a.key, b.key),
    );

  const once = new Set<string>();
  const noteOnce = (finding: Diagnostic, about: string) => {
    const seen = `${finding.code} ${about}`;
    if (once.has(seen)) return;
    once.add(seen);
    diagnostics.push(finding);
  };

  const built: BuiltDividend[] = [];
  for (const dividend of paid) {
    const isin = dividend.security.isin;
    const params = { isin, date: dividend.date };
    if (!dividend.gross.amount.isPositive()) {
      diagnostics.push(
        diagnostic("blocking", "dividendNotPositive", params, dividend.source),
      );
      continue;
    }
    const rate = lookup(
      dividend.gross.currency,
      dividend.date,
      dividend.source,
    );
    if (rate === null) continue;

    // The tax converts at the payment date's rate, in its own currency.
    const withholdings = withheld.get(dividend.key) ?? [];
    let foreignTax = Decimal.ZERO;
    let convertible = true;
    for (const w of withholdings) {
      const wRate =
        w.amount.currency === dividend.gross.currency
          ? rate
          : lookup(w.amount.currency, dividend.date, w.source);
      if (wRate === null) convertible = false;
      else foreignTax = foreignTax.plus(w.amount.amount.dividedBy(wRate.rate));
    }
    if (!convertible) continue;
    if (foreignTax.isNegative()) {
      diagnostics.push(
        diagnostic("blocking", "foreignTaxNegative", params, dividend.source),
      );
      continue;
    }

    const grossExact = dividend.gross.amount.dividedBy(rate.rate);
    const payer = input.payers.get(isin);
    const sourceCountry =
      payer?.sourceCountry ?? fursCountryFromIso(isin.slice(0, 2));
    const slovenian = payer?.country === "SI";
    const foreignTaxEur = slovenian ? Decimal.ZERO : cents(foreignTax);

    let record: DividendRecord | null = null;
    if (payer === undefined) {
      noteOnce(
        diagnostic("blocking", "payerUnknown", { isin }, dividend.source),
        isin,
      );
    } else if (sourceCountry === null) {
      noteOnce(
        diagnostic(
          "blocking",
          "sourceCountryUnknown",
          { isin },
          dividend.source,
        ),
        isin,
      );
    } else {
      if (slovenian) {
        // A Slovenian payer withholds Slovenian tax itself, and such a
        // dividend is then not reported on Doh-Div at all (02 §3.4).
        diagnostics.push(
          diagnostic("warning", "slovenianPayer", params, dividend.source),
        );
      }
      let id = payer.identificationNumber;
      if (id === undefined && !slovenian) {
        id = isin;
        noteOnce(diagnostic("info", "payerIdIsIsin", { isin }), isin);
      }
      record = {
        date: dividend.date,
        payer: {
          name: payer.name,
          address: payer.address,
          country: payer.country,
          ...(id === undefined ? {} : { identificationNumber: id }),
          ...(payer.taxNumber === undefined
            ? {}
            : { taxNumber: payer.taxNumber }),
        },
        type: dividend.security.isFund === true ? "4" : "1",
        grossEur: grossExact,
        ...(slovenian ? {} : { foreignTaxEur: foreignTax }),
        sourceCountry,
      };
    }

    // The credit, for the estimate. A treaty cap matters only where tax was
    // withheld; without one, only the Slovenian tax caps the credit.
    const grossEur = cents(grossExact);
    let treatyRate: Decimal | null = null;
    if (foreignTaxEur.isPositive() && sourceCountry !== null) {
      treatyRate =
        input.treatyRates?.get(sourceCountry) ??
        treatyDividendRate(sourceCountry);
      if (treatyRate === null) {
        noteOnce(
          diagnostic("warning", "treatyRateUnknown", {
            country: sourceCountry,
          }),
          sourceCountry,
        );
      }
    }
    const credit = dividendCredit(grossEur, foreignTaxEur, treatyRate);
    if (credit.excess.isPositive() && treatyRate !== null) {
      diagnostics.push(
        diagnostic(
          "warning",
          "excessWithholding",
          {
            ...params,
            country: sourceCountry ?? "",
            withheldEur: foreignTaxEur.toFixed(2, "halfUp"),
            treatyRate: treatyRate.toString(),
            creditEur: credit.credit.toFixed(2, "halfUp"),
            excessEur: credit.excess.toFixed(2, "halfUp"),
          },
          dividend.source,
        ),
      );
    }

    built.push({
      record,
      date: dividend.date,
      security: dividend.security,
      gross: dividend.gross,
      withholdings: withholdings.map((w) => w.amount),
      rate,
      broker: dividend.broker,
      source: dividend.source,
      grossEur,
      foreignTaxEur,
      sourceCountry,
      treatyRate,
      credit,
    });
  }

  const records = numberSharedPayerIds(
    built.flatMap((b) => (b.record === null ? [] : [b.record])),
    diagnostics,
  );

  const sum = (pick: (b: BuiltDividend) => Decimal) =>
    Decimal.sum(built.map(pick));
  const estimate: DividendsEstimate = {
    taxRate: DIVIDEND_TAX_RATE,
    grossEur: sum((b) => b.grossEur),
    foreignTaxEur: sum((b) => b.foreignTaxEur),
    creditEur: sum((b) => b.credit.credit),
    taxDueEur: sum((b) => b.credit.taxDue),
  };
  const draft: DohDiv = {
    taxYear: input.taxYear,
    taxpayer: input.taxpayer,
    dividends: records,
  };
  // The writer's own rules, run here so that a form handed out is one the
  // writer takes: a payer's details can still break them. Only when nothing
  // else blocks, so the review shows causes, not their echoes.
  if (records.length > 0 && !hasBlocking(diagnostics)) {
    diagnostics.push(...formIssues(validateDohDiv(draft)));
  }
  const form = records.length === 0 || hasBlocking(diagnostics) ? null : draft;
  return { form, dividends: built, estimate, diagnostics };
}

/**
 * Two records with one payer ID on one day are a critical error in eDavki.
 * FURS's guide numbers such records 1, 2, … in place of the ID, counting
 * per day so that two payers' numbers never meet (02 §5).
 */
function numberSharedPayerIds(
  records: readonly DividendRecord[],
  diagnostics: Diagnostic[],
): DividendRecord[] {
  const counts = new Map<string, number>();
  const keyOf = (r: DividendRecord) => {
    const id = r.payer.identificationNumber;
    return id === undefined ? null : `${r.date} ${idKey(id)}`;
  };
  for (const record of records) {
    const key = keyOf(record);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const next = new Map<string, number>();
  const numbered = new Map<string, number>();
  const result = records.map((record) => {
    const key = keyOf(record);
    if (key === null || (counts.get(key) ?? 0) < 2) return record;
    const n = (next.get(record.date) ?? 0) + 1;
    next.set(record.date, n);
    numbered.set(record.date, (numbered.get(record.date) ?? 0) + 1);
    return {
      ...record,
      payer: { ...record.payer, identificationNumber: String(n) },
    };
  });
  for (const [date, count] of numbered) {
    diagnostics.push(
      diagnostic("info", "payerIdsNumbered", { date, count: String(count) }),
    );
  }
  return result;
}
