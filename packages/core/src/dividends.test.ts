/**
 * The dividend credit against the worked example of
 * docs/research/04-si-tax-rules.md §7.3: 100 USD at 1.10 is 90.91 EUR.
 */
import { describe, expect, it } from "vitest";

import { Decimal } from "./decimal.js";
import { dividendCredit, treatyDividendRate } from "./dividends.js";

const d = (value: string) => Decimal.parse(value);
const cents = (value: Decimal) => value.toFixed(2, "halfUp");

function credit(gross: string, tax: string, treaty: string | null) {
  const result = dividendCredit(
    d(gross),
    d(tax),
    treaty === null ? null : d(treaty),
  );
  return [
    cents(result.slovenianTax),
    cents(result.credit),
    cents(result.excess),
    cents(result.taxDue),
  ];
}

describe("dividendCredit", () => {
  it("credits US tax withheld at the treaty's 15% in full (W-8BEN on file)", () => {
    expect(credit("90.91", "13.64", "0.15")).toEqual([
      "22.73",
      "13.64",
      "0.00",
      "9.09",
    ]);
  });

  it("caps 30% US withholding at the treaty's 15%", () => {
    // The research table's 13.64 lost converts the 15 USD on its own; in
    // cents of the amounts as written it is 27.27 - 13.64 = 13.63.
    expect(credit("90.91", "27.27", "0.15")).toEqual([
      "22.73",
      "13.64",
      "13.63",
      "9.09",
    ]);
  });

  it("never credits more than the Slovenian tax", () => {
    expect(credit("100.00", "35.00", null)).toEqual([
      "25.00",
      "25.00",
      "0.00",
      "0.00",
    ]);
  });

  it("owes the full 25% when nothing was withheld", () => {
    expect(credit("20.16", "0.00", null)).toEqual([
      "5.04",
      "0.00",
      "0.00",
      "5.04",
    ]);
  });

  it("rounds each payment's tax and cap to cents, half up", () => {
    // 25% of 2.34 is 0.585; 15% of 12.05 is 1.8075.
    expect(credit("2.34", "0.35", "0.15")).toEqual([
      "0.59",
      "0.35",
      "0.00",
      "0.24",
    ]);
    expect(credit("12.05", "1.81", "0.15")[1]).toBe("1.81");
  });
});

describe("treatyDividendRate", () => {
  it("knows only the treaty rates the research has sourced", () => {
    expect(treatyDividendRate("US")?.toString()).toBe("0.15");
    expect(treatyDividendRate("DE")).toBeNull();
  });
});
