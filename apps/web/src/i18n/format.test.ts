import { describe, expect, it } from "vitest";

import {
  formatCountry,
  formatDate,
  formatEur,
  formatEurParts,
  formatKilobytes,
  formatMoney,
  formatMonth,
  formatNumber,
  formatPercent,
  isNegative,
  plural,
} from "./format";

// Intl separates digit groups and units with (narrow) no-break spaces; compare
// with plain spaces so the expectations stay readable.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("formatNumber", () => {
  it("formats decimal strings exactly, beyond float precision", () => {
    // 17 significant digits: a float would already have rounded this.
    expect(
      formatNumber("12345678901234567.125", "sl", { minFraction: 2 }),
    ).toBe("12.345.678.901.234.567,13");
  });

  it("rounds half up, away from zero", () => {
    expect(formatNumber("2.345", "en", { minFraction: 2 })).toBe("2.35");
    expect(formatNumber("-2.345", "en", { minFraction: 2 })).toBe("-2.35");
  });

  it("follows Slovenian grouping (none below 10.000) and decimal comma", () => {
    expect(formatNumber("1234.5", "sl", { minFraction: 2 })).toBe("1234,50");
    expect(formatNumber("12345.5", "sl", { minFraction: 2 })).toBe("12.345,50");
    expect(formatNumber("1234.5", "en", { minFraction: 2 })).toBe("1,234.50");
  });

  it("keeps up to 8 decimals for per-unit values and drops trailing zeros", () => {
    expect(formatNumber("4.56380000", "sl", { maxFraction: 8 })).toBe("4,5638");
    expect(
      formatNumber("45.07508044", "en", { minFraction: 2, maxFraction: 8 }),
    ).toBe("45.07508044");
  });

  it("signs gains when asked, with a real minus sign for losses", () => {
    expect(formatNumber("5", "en", { signed: true })).toBe("+5");
    expect(formatNumber("-427.5", "sl", { minFraction: 2, signed: true })).toBe(
      "−427,50",
    );
    expect(formatNumber("0", "en", { signed: true })).toBe("0");
  });

  it("rejects anything that is not a plain decimal string", () => {
    for (const bad of ["1e3", "1,5", " 1", "NaN", "", "1.", ".5", "Infinity"]) {
      expect(() => formatNumber(bad, "en")).toThrow(RangeError);
    }
  });
});

describe("currency, percent and size formatting", () => {
  it("formats euros at cent precision in each locale", () => {
    expect(plain(formatEur("1770.04", "sl"))).toBe("1770,04 €");
    expect(formatEur("1770.04", "en")).toBe("€1,770.04");
    expect(plain(formatEur("-427.5", "sl", { signed: true }))).toBe(
      "−427,50 €",
    );
  });

  it("keeps every digit of a broker price, at least two, with the ISO code", () => {
    expect(plain(formatMoney("214.87", "USD", "en"))).toBe("USD 214.87");
    expect(plain(formatMoney("98.9100", "USD", "sl"))).toBe("98,9100 USD");
    expect(plain(formatMoney("17.4", "GBP", "sl"))).toBe("17,40 GBP");
  });

  it("formats fractions as percentages", () => {
    expect(plain(formatPercent("0.15", "sl"))).toBe("15 %");
    expect(formatPercent("0.26375", "en")).toBe("26.375%");
  });

  it("never shows a non-empty file as 0 KB", () => {
    expect(plain(formatKilobytes(1, "en"))).toBe("1 kB");
    expect(plain(formatKilobytes(2049, "en"))).toBe("3 kB");
  });

  it("detects negative values but not negative zero", () => {
    expect(isNegative("-0.01")).toBe(true);
    expect(isNegative("-0.00")).toBe(false);
    expect(isNegative("12")).toBe(false);
  });
});

describe("formatEurParts", () => {
  const cases: [string, "sl" | "en", boolean][] = [
    ["1770.04", "sl", false],
    ["1770.04", "en", false],
    ["16706.51", "sl", false],
    ["-427.50", "sl", false],
    ["-427.50", "en", false],
    ["8304.21", "en", true],
    ["0.00", "sl", true],
  ];

  it("joins back to exactly what formatEur shows, in every locale", () => {
    for (const [value, locale, signed] of cases) {
      const runs = formatEurParts(value, locale, { signed });
      expect(runs.map((r) => r.text).join(""), `${value} ${locale}`).toBe(
        formatEur(value, locale, { signed }),
      );
    }
  });

  it("separates whole units, cents and the currency in the locale's order", () => {
    expect(
      formatEurParts("16706.51", "sl").map((r) => [r.role, plain(r.text)]),
    ).toEqual([
      ["main", "16.706"],
      ["cents", ",51"],
      ["currency", " €"],
    ]);
    expect(formatEurParts("-427.50", "en").map((r) => r.role)).toEqual([
      "main",
      "currency",
      "main",
      "cents",
    ]);
  });
});

describe("formatMonth", () => {
  it("names a month for a chart axis and for screen readers", () => {
    expect(formatMonth("2026-03", "sl", "long")).toBe("marec");
    expect(formatMonth("2026-03", "en", "long")).toBe("March");
    expect(formatMonth("2026-05", "en", "narrow")).toBe("M");
  });

  it("rejects anything but an ISO month", () => {
    expect(() => formatMonth("2026-3", "en", "long")).toThrow(RangeError);
  });
});

describe("formatDate and formatCountry", () => {
  it("formats ISO dates without shifting the day across time zones", () => {
    expect(plain(formatDate("2026-03-12", "sl"))).toBe("12. 3. 2026");
    expect(formatDate("2026-03-12", "en")).toBe("12 Mar 2026");
    expect(plain(formatDate("2027-01-01", "sl"))).toBe("1. 1. 2027");
  });

  it("rejects malformed dates", () => {
    expect(() => formatDate("12.3.2026", "sl")).toThrow(RangeError);
  });

  it("names countries in the UI language", () => {
    expect(formatCountry("DE", "sl")).toBe("Nemčija");
    expect(formatCountry("DE", "en")).toBe("Germany");
  });
});

describe("plural", () => {
  const rows = {
    one: "{n} vrstica",
    two: "{n} vrstici",
    few: "{n} vrstice",
    other: "{n} vrstic",
  };

  it("uses the Slovenian dual and 'few' forms", () => {
    expect(plural(1, "sl", rows)).toBe("1 vrstica");
    expect(plural(2, "sl", rows)).toBe("2 vrstici");
    expect(plural(3, "sl", rows)).toBe("3 vrstice");
    expect(plural(5, "sl", rows)).toBe("5 vrstic");
    expect(plural(101, "sl", rows)).toBe("101 vrstica");
    expect(plural(102, "sl", rows)).toBe("102 vrstici");
  });

  it("falls back to 'other' when a form is missing", () => {
    expect(plural(2, "sl", { one: "{n} a", other: "{n} b" })).toBe("2 b");
    expect(plural(1, "en", { one: "{n} row", other: "{n} rows" })).toBe(
      "1 row",
    );
  });
});
