/**
 * The dividend-tax estimate shown next to Doh-Div. eDavki computes the real
 * tax; this mirrors its rules so the user is not surprised
 * (docs/research/04-si-tax-rules.md §2.2, §7.2, §7.3; 02 §6):
 *
 * - a dividend is taxed at 25% of its gross amount, a final tax
 *   (ZDoh-2 Art. 132(1));
 * - foreign tax is credited per payment, up to the lower of the tax actually
 *   withheld and the Slovenian tax on that payment (Art. 137(1));
 * - under a tax treaty only tax at the treaty rate is final (Art. 137(2)), so
 *   the credit never exceeds the treaty rate on the gross amount; what was
 *   withheld above it can only be reclaimed from the source state.
 *
 * Each payment's figures are in cents, rounded half up like every Doh-Div
 * amount, and totals add those cents.
 */
import { Decimal } from "./decimal.js";

/** ZDoh-2 Art. 132(1); 27.5% applied only in 2020 and 2021 (04 §2.2). */
export const DIVIDEND_TAX_RATE = Decimal.parse("0.25");

/**
 * Treaty caps on portfolio dividends paid to an individual, by FURS country
 * code, for the treaties docs/research has the text of. US: 15%, SI–US
 * convention Art. 10(2)(b); the 5% rate is for companies only (04 §7.3).
 */
const TREATY_DIVIDEND_RATES: ReadonlyMap<string, Decimal> = new Map([
  ["US", Decimal.parse("0.15")],
]);

/** The treaty cap on dividends from `country`, or null where none is known. */
export function treatyDividendRate(country: string): Decimal | null {
  return TREATY_DIVIDEND_RATES.get(country) ?? null;
}

export interface DividendCredit {
  /** 25% of the gross amount. */
  readonly slovenianTax: Decimal;
  /** The foreign tax that may be credited. */
  readonly credit: Decimal;
  /** Withheld above the treaty cap: never creditable, reclaimable only abroad. */
  readonly excess: Decimal;
  /** The Slovenian tax less the credit: what is left to pay. */
  readonly taxDue: Decimal;
}

const cents = (value: Decimal) => value.round(2, "halfUp");
const lower = (a: Decimal, b: Decimal) => (a.lessThan(b) ? a : b);

/**
 * The credit on one payment. `grossEur` and `foreignTaxEur` are the amounts
 * as written, in cents, the tax zero or more; `treatyRate` is null where no
 * treaty rate is known, and then only the Slovenian tax caps the credit.
 */
export function dividendCredit(
  grossEur: Decimal,
  foreignTaxEur: Decimal,
  treatyRate: Decimal | null,
): DividendCredit {
  const slovenianTax = cents(DIVIDEND_TAX_RATE.times(grossEur));
  const final =
    treatyRate === null
      ? foreignTaxEur
      : lower(foreignTaxEur, cents(treatyRate.times(grossEur)));
  const credit = lower(final, slovenianTax);
  return {
    slovenianTax,
    credit,
    excess: foreignTaxEur.minus(final),
    taxDue: slovenianTax.minus(credit),
  };
}
