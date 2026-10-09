import { Decimal } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { divDemo2026, divResearchExample } from "../test/scenarios.js";
import {
  FURS_COUNTRIES,
  fursCountryFromIso,
  isFursCountry,
} from "./countries.js";
import {
  DIVIDEND_TYPES,
  validateDohDiv,
  writeDohDiv,
  type DividendRecord,
  type DohDiv,
} from "./div.js";
import { FormValidationError } from "./issues.js";

const d = (value: string) => Decimal.parse(value);

const dividend = (overrides: Partial<DividendRecord> = {}): DividendRecord => ({
  date: "2026-05-14",
  payer: {
    name: "Apple Inc.",
    address: "One Apple Park Way, Cupertino, CA 95014, United States",
    country: "US",
    identificationNumber: "94-2404110",
  },
  type: "1",
  grossEur: d("22.22"),
  foreignTaxEur: d("3.33"),
  sourceCountry: "US",
  ...overrides,
});

const form = (
  dividends: readonly DividendRecord[],
  overrides: Partial<DohDiv> = {},
): DohDiv => ({
  taxYear: 2026,
  taxpayer: { taxNumber: "12345678" },
  dividends,
  ...overrides,
});

const issues = (model: DohDiv) =>
  validateDohDiv(model).map((issue) => `${issue.code} ${issue.path}`);

describe("FURS country list", () => {
  it("is FURS's 251 codes, with Greece as EL", () => {
    expect(FURS_COUNTRIES).toHaveLength(251);
    expect(new Set(FURS_COUNTRIES).size).toBe(251);
    expect(isFursCountry("EL")).toBe(true);
    expect(isFursCountry("GR")).toBe(false);
    expect(isFursCountry("XK")).toBe(true);
    expect(fursCountryFromIso("GR")).toBe("EL");
    expect(fursCountryFromIso("US")).toBe("US");
    expect(fursCountryFromIso("UK")).toBeNull();
  });
});

describe("validateDohDiv", () => {
  it("accepts well-formed returns", () => {
    expect(issues(form([dividend()]))).toEqual([]);
    expect(issues(divResearchExample)).toEqual([]);
    expect(issues(divDemo2026)).toEqual([]);
  });

  it("requires the tax number and at least one dividend", () => {
    expect(issues(form([], { taxpayer: { taxNumber: "1" } }))).toEqual([
      "taxNumber taxpayer.taxNumber",
      "noDividends dividends",
    ]);
  });

  it("keeps each payment in the tax year", () => {
    expect(issues(form([dividend({ date: "2025-12-31" })]))).toEqual([
      "dividendOutsideTaxYear dividends[0].date",
    ]);
    expect(issues(form([dividend({ date: "2026-13-01" })]))).toEqual([
      "invalidDate dividends[0].date",
    ]);
  });

  it("needs a positive gross amount at the cent it is written at", () => {
    expect(
      issues(form([dividend({ grossEur: d("0.004"), foreignTaxEur: d("0") })])),
    ).toEqual(["valueNotPositive dividends[0].grossEur"]);
  });

  it("keeps the foreign tax between zero and the gross amount", () => {
    expect(issues(form([dividend({ foreignTaxEur: d("22.23") })]))).toEqual([
      "foreignTaxAboveValue dividends[0].foreignTaxEur",
    ]);
    expect(issues(form([dividend({ foreignTaxEur: d("-0.01") })]))).toEqual([
      "valueNegative dividends[0].foreignTaxEur",
    ]);
    // Equal after rounding to cents is fine.
    expect(issues(form([dividend({ foreignTaxEur: d("22.224") })]))).toEqual(
      [],
    );
  });

  it("refuses a negative foreign tax even where it would round to zero", () => {
    expect(issues(form([dividend({ foreignTaxEur: d("-0.004") })]))).toEqual([
      "valueNegative dividends[0].foreignTaxEur",
    ]);
  });

  it("bounds amounts the schema leaves unbounded", () => {
    expect(
      issues(form([dividend({ grossEur: d("100000000000000") })])),
    ).toEqual(["valueTooLarge dividends[0].grossEur"]);
    expect(
      issues(form([dividend({ grossEur: d("99999999999999.99") })])),
    ).toEqual([]);
  });

  it("reads null, as JSON writes an absent value, as absent", () => {
    const slovenian = dividend({
      payer: {
        name: "Primer, d. d.",
        address: "Trubarjeva cesta 1, 1000 Ljubljana",
        country: "SI",
        taxNumber: "87654321",
        identificationNumber: null as never,
      },
      foreignTaxEur: null as never,
      sourceCountry: "SI",
    });
    expect(issues(form([slovenian]))).toEqual([]);
    expect(writeDohDiv(form([slovenian]))).not.toContain("<ForeignTax>");
    // For a foreign payer, a null ID is a missing ID.
    expect(
      issues(
        form([
          dividend({
            payer: { ...dividend().payer, identificationNumber: null as never },
          }),
        ]),
      ),
    ).toEqual(["payerIdMissing dividends[0].payer.identificationNumber"]);
  });

  it("checks the payer's ID like any text field", () => {
    expect(
      issues(
        form([
          dividend({
            payer: {
              ...dividend().payer,
              identificationNumber: "94-24\t04110",
            },
          }),
        ]),
      ),
    ).toEqual(["invalidCharacter dividends[0].payer.identificationNumber"]);
  });

  it("checks that dividends are an array and amounts are Decimals", () => {
    expect(issues(form({ length: 0 } as never))).toEqual([
      "notArray dividends",
    ]);
    expect(issues(form([dividend({ grossEur: null as never })]))).toEqual([
      "notDecimal dividends[0].grossEur",
    ]);
    expect(issues(form([dividend({ foreignTaxEur: 3.33 as never })]))).toEqual([
      "notDecimal dividends[0].foreignTaxEur",
    ]);
  });

  it("catches holes in the list of dividends", () => {
    const dividends: DividendRecord[] = [];
    dividends[1] = dividend();
    expect(issues(form(dividends))).toEqual(["entryMissing dividends[0]"]);
    expect(Object.isFrozen(DIVIDEND_TYPES)).toBe(true);
    expect(Object.isFrozen(FURS_COUNTRIES)).toBe(true);
  });

  it("requires foreign tax from a foreign payer, even when it is zero", () => {
    const { foreignTaxEur, ...rest } = dividend();
    expect(foreignTaxEur).toBeDefined();
    expect(issues(form([rest]))).toEqual([
      "foreignTaxMissing dividends[0].foreignTaxEur",
    ]);
  });

  it("follows FURS's rules for a Slovenian payer", () => {
    const slovenian = dividend({
      payer: {
        name: "Primer, d. d.",
        address: "Trubarjeva cesta 1, 1000 Ljubljana",
        country: "SI",
      },
      sourceCountry: "SI",
    });
    expect(issues(form([slovenian]))).toEqual([
      "payerTaxNumber dividends[0].payer.taxNumber",
      "foreignTaxForSlovenianPayer dividends[0].foreignTaxEur",
    ]);
    const { foreignTaxEur, ...withoutTax } = slovenian;
    expect(foreignTaxEur).toBeDefined();
    expect(
      issues(
        form([
          {
            ...withoutTax,
            payer: { ...slovenian.payer, taxNumber: "87654321" },
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("requires a foreign payer's ID and refuses a Slovenian tax number for it", () => {
    expect(
      issues(
        form([
          dividend({
            payer: {
              name: "A",
              address: "B",
              country: "US",
              taxNumber: "12345678",
            },
          }),
        ]),
      ),
    ).toEqual([
      "payerTaxNumberForForeignPayer dividends[0].payer.taxNumber",
      "payerIdMissing dividends[0].payer.identificationNumber",
    ]);
  });

  it("refuses two records with one payer ID on one day, a critical error in eDavki", () => {
    expect(issues(form([dividend(), dividend()]))).toEqual([
      "duplicatePayerId dividends[1].payer.identificationNumber",
    ]);
    expect(
      issues(form([dividend(), dividend({ date: "2026-05-15" })])),
    ).toEqual([]);
  });

  it("compares payer IDs without case or spaces", () => {
    const irish = (identificationNumber: string) =>
      dividend({ payer: { ...dividend().payer, identificationNumber } });
    expect(issues(form([irish("IE6388047V"), irish("ie 6388047v")]))).toEqual([
      "duplicatePayerId dividends[1].payer.identificationNumber",
    ]);
  });

  it("checks countries, the type code and the payer's text", () => {
    expect(
      issues(
        form([
          dividend({
            type: "9" as DividendRecord["type"],
            sourceCountry: "GR" as DividendRecord["sourceCountry"],
            payer: {
              name: "",
              address: "A\tB",
              country: "UK" as DividendRecord["sourceCountry"],
              identificationNumber: "1",
            },
          }),
        ]),
      ),
    ).toEqual([
      "textMissing dividends[0].payer.name",
      "invalidCharacter dividends[0].payer.address",
      "country dividends[0].payer.country",
      "country dividends[0].sourceCountry",
      "dividendType dividends[0].type",
    ]);
  });

  it("keeps a relief statement within 100 characters", () => {
    expect(
      issues(form([dividend({ reliefStatement: "x".repeat(101) })])),
    ).toEqual(["textTooLong dividends[0].reliefStatement"]);
  });
});

describe("writeDohDiv", () => {
  const xml = writeDohDiv(divResearchExample);

  it("writes amounts in EUR at two decimals, rounded half up", () => {
    // research 02 §8: 26.00 / 1.1702 = 22.22, 3.90 / 1.1702 = 3.33, 15.00 / 1.1340 = 13.23.
    expect(xml).toContain("<Value>22.22</Value>");
    expect(xml).toContain("<ForeignTax>3.33</ForeignTax>");
    expect(xml).toContain("<Value>13.23</Value>");
    expect(xml).toContain("<ForeignTax>0.00</ForeignTax>");
  });

  it("puts the Dividend records beside Doh_Div, with no bodyContent", () => {
    expect(xml).not.toContain("bodyContent");
    expect(xml).toMatch(/<\/Doh_Div>\s*<Dividend>/);
  });

  it("omits what does not apply: ForeignTax for a Slovenian payer, an unclaimed relief", () => {
    const out = writeDohDiv(
      form([
        {
          ...dividend({ sourceCountry: "SI" }),
          payer: {
            name: "Primer, d. d.",
            address: "Trubarjeva cesta 1, 1000 Ljubljana",
            country: "SI",
            taxNumber: "87654321",
          },
          foreignTaxEur: undefined,
        } as unknown as DividendRecord,
      ]),
    );
    expect(out).toContain("<PayerTaxNumber>87654321</PayerTaxNumber>");
    expect(out).not.toContain("<ForeignTax>");
    expect(out).not.toContain("<ReliefStatement>");
    expect(out).not.toContain("<PayerIdentificationNumber>");
  });

  it("escapes payer text and keeps Slovenian letters", () => {
    const out = writeDohDiv(
      form([
        dividend({
          payer: {
            name: "Procter & Gamble <Co>",
            address: "Königinstraße 28",
            country: "US",
            identificationNumber: "1",
          },
        }),
      ]),
    );
    expect(out).toContain(
      "<PayerName>Procter &amp; Gamble &lt;Co&gt;</PayerName>",
    );
    expect(writeDohDiv(divResearchExample)).toContain(
      "10/01, 2b odstavek 10. člena",
    );
  });

  it("refuses a form with issues", () => {
    expect(() => writeDohDiv(form([]))).toThrow(FormValidationError);
  });
});
