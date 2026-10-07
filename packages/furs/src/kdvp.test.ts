import { Decimal } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { kdvpDemo2026, kdvpMatchedLots, TAXPAYER } from "../test/scenarios.js";
import { FormValidationError, type FormIssueCode } from "./issues.js";
import {
  isIsin,
  validateDohKdvp,
  writeDohKdvp,
  type DohKdvp,
  type KdvpList,
  type KdvpPurchase,
  type KdvpRow,
  type KdvpSale,
} from "./kdvp.js";

const d = (value: string) => Decimal.parse(value);

const purchase = (
  date: string,
  quantity: string,
  unit = "10",
): KdvpPurchase => ({
  kind: "purchase",
  date,
  method: "B",
  quantity: d(quantity),
  unitCostEur: d(unit),
});

const sale = (date: string, quantity: string, unit = "12"): KdvpSale => ({
  kind: "sale",
  date,
  quantity: d(quantity),
  unitValueEur: d(unit),
});

const list = (
  rows: readonly KdvpRow[],
  overrides: Partial<KdvpList> = {},
): KdvpList => ({
  isin: "US0378331005",
  ticker: "AAPL",
  name: "Apple Inc.",
  isFund: false,
  rows,
  ...overrides,
});

const form = (
  lists: readonly KdvpList[],
  overrides: Partial<DohKdvp> = {},
): DohKdvp => ({
  taxYear: 2026,
  taxpayer: { taxNumber: "12345678" },
  lists,
  ...overrides,
});

const valid = list([purchase("2024-01-02", "10"), sale("2026-03-04", "10")]);

/** The codes a form produces, with their paths, for compact expectations. */
const issues = (model: DohKdvp) =>
  validateDohKdvp(model).map((issue) => `${issue.code} ${issue.path}`);

describe("validateDohKdvp", () => {
  it("accepts a well-formed return", () => {
    expect(issues(form([valid]))).toEqual([]);
    expect(issues(kdvpDemo2026)).toEqual([]);
  });

  it("requires an eight-digit tax number, which the schema itself does not", () => {
    for (const taxNumber of [
      "",
      "1234567",
      "123456789",
      "1234567a",
      "00000000",
    ]) {
      expect(issues(form([valid], { taxpayer: { taxNumber } }))).toEqual([
        "taxNumber taxpayer.taxNumber",
      ]);
    }
  });

  it("requires a tax year the schema can carry", () => {
    expect(issues(form([valid], { taxYear: 2012 }))).toContain(
      "taxYear taxYear",
    );
    expect(issues(form([valid], { taxYear: 2026.5 }))).toContain(
      "taxYear taxYear",
    );
  });

  it("refuses an empty return", () => {
    expect(issues(form([]))).toEqual(["noLists lists"]);
  });

  it("refuses a list without a purchase or without a sale, as eDavki does", () => {
    expect(issues(form([list([purchase("2024-01-02", "10")])]))).toEqual([
      "listWithoutSale lists[0]",
    ]);
    // A sale alone also drives the running stock below zero.
    expect(issues(form([list([sale("2026-03-04", "1")])]))).toEqual([
      "listWithoutPurchase lists[0]",
      "negativeBalance lists[0].rows[0]",
    ]);
  });

  it("keeps one list per security, merged across brokers", () => {
    expect(issues(form([valid, valid]))).toEqual([
      "duplicateList lists[1].isin",
    ]);
  });

  it("checks the ISIN, including its check digit", () => {
    expect(isIsin("US0378331005")).toBe(true);
    expect(isIsin("IE00BK5BQT80")).toBe(true);
    expect(isIsin("NL0010273215")).toBe(true);
    expect(isIsin("US0378331006")).toBe(false);
    expect(isIsin("us0378331005")).toBe(false);
    expect(isIsin("US037833100")).toBe(false);
    expect(issues(form([list(valid.rows, { isin: "US0378331006" })]))).toEqual([
      "isin lists[0].isin",
    ]);
  });

  it("keeps the ticker and name within the schema's lengths", () => {
    expect(
      issues(
        form([
          list(valid.rows, { ticker: "ABCDEFGHIJK", name: "x".repeat(101) }),
        ]),
      ),
    ).toEqual(["textTooLong lists[0].ticker", "textTooLong lists[0].name"]);
    expect(issues(form([list(valid.rows, { name: "  " })]))).toEqual([
      "textMissing lists[0].name",
    ]);
    expect(issues(form([list(valid.rows, { name: "A\nB" })]))).toEqual([
      "invalidCharacter lists[0].name",
    ]);
  });

  it("requires rows in date order, with real dates", () => {
    expect(
      issues(
        form([
          list([
            purchase("2025-01-02", "5"),
            purchase("2024-01-02", "5"),
            sale("2026-03-04", "10"),
          ]),
        ]),
      ),
    ).toEqual(["rowsNotChronological lists[0].rows[1].date"]);
    expect(
      issues(
        form([list([purchase("2024-02-30", "10"), sale("2026-03-04", "10")])]),
      ),
    ).toEqual(["invalidDate lists[0].rows[0].date"]);
  });

  it("puts sales in the tax year and no purchase after it", () => {
    expect(
      issues(
        form([list([purchase("2024-01-02", "10"), sale("2025-12-31", "10")])]),
      ),
    ).toEqual(["saleOutsideTaxYear lists[0].rows[1].date"]);
    expect(
      issues(
        form([
          list([
            purchase("2024-01-02", "10"),
            sale("2026-03-04", "5"),
            purchase("2027-01-04", "1"),
          ]),
        ]),
      ),
    ).toEqual(["purchaseAfterTaxYear lists[0].rows[2].date"]);
  });

  it("never rounds a quantity: it must fit 8 decimals exactly", () => {
    expect(
      issues(
        form([
          list([
            purchase("2024-01-02", "0.1234567891"),
            sale("2026-03-04", "0.1234567891"),
          ]),
        ]),
      ),
    ).toEqual([
      "quantityPrecision lists[0].rows[0].quantity",
      "quantityPrecision lists[0].rows[1].quantity",
    ]);
    expect(
      issues(
        form([list([purchase("2024-01-02", "0"), sale("2026-03-04", "-1")])]),
      ),
    ).toEqual([
      "quantityNotPositive lists[0].rows[0].quantity",
      "quantityNotPositive lists[0].rows[1].quantity",
    ]);
    expect(
      issues(
        form([
          list([
            purchase("2024-01-02", "1000000000000"),
            sale("2026-03-04", "1"),
          ]),
        ]),
      ),
    ).toEqual([
      "quantityTooLarge lists[0].rows[0].quantity",
      "balanceTooLarge lists[0].rows[0]",
    ]);
  });

  it("refuses negative or oversized per-unit values", () => {
    expect(
      issues(
        form([
          list([
            purchase("2024-01-02", "1", "-0.01"),
            sale("2026-03-04", "1", "100000000000000"),
          ]),
        ]),
      ),
    ).toEqual([
      "valueNegative lists[0].rows[0].unitCostEur",
      "valueTooLarge lists[0].rows[1].unitValueEur",
    ]);
  });

  it("accepts a zero cost, as for bonus shares", () => {
    expect(
      issues(
        form([
          list([purchase("2024-01-02", "1", "0"), sale("2026-03-04", "1")]),
        ]),
      ),
    ).toEqual([]);
  });

  it("never lets the running stock go below zero", () => {
    expect(
      issues(
        form([
          list([purchase("2024-01-02", "10"), sale("2026-03-04", "10.5")]),
        ]),
      ),
    ).toEqual(["negativeBalance lists[0].rows[1]"]);
  });

  it("checks the taxpayer's text fields", () => {
    expect(
      issues(
        form([valid], {
          taxpayer: { ...TAXPAYER, postNumber: "1".repeat(13), name: "" },
        }),
      ),
    ).toEqual(["textMissing taxpayer.name", "textTooLong taxpayer.postNumber"]);
  });
});

describe("writeDohKdvp", () => {
  const xml = writeDohKdvp(kdvpMatchedLots);

  it("writes per-unit values rounded half up to 8 decimals, quantities exactly", () => {
    // research 01 §10: 172.62 / 1.0892, 209.27 / 1.0966 and 250.00 / 1.16.
    expect(xml).toContain("<F4>158.48329049</F4>");
    expect(xml).toContain("<F4>190.83530914</F4>");
    expect(xml).toContain("<F9>215.51724138</F9>");
    expect(xml).toContain("<F3>10</F3>");
    expect(xml).toContain("<F7>12</F7>");
  });

  it("numbers rows from 0 and keeps the running stock in F8", () => {
    const rows = [
      ...xml.matchAll(/<ID>(\d+)<\/ID>[^]*?<F8>([^<]+)<\/F8>/g),
    ].map((m) => [m[1], m[2]]);
    expect(rows).toEqual([
      ["0", "10"],
      ["1", "12"],
      ["2", "0"],
    ]);
  });

  it("writes F10 only when it has been determined, as lowercase true or false", () => {
    expect(xml).toContain("<F10>true</F10>");
    const undetermined = writeDohKdvp(form([valid]));
    expect(undetermined).not.toContain("<F10>");
    const determined = writeDohKdvp(
      form([
        list([
          purchase("2024-01-02", "1"),
          { ...sale("2026-03-04", "1"), lossReducesBase: false },
        ]),
      ]),
    );
    expect(determined).toContain("<F10>false</F10>");
  });

  it("omits the optional elements it has no value for", () => {
    const bare = writeDohKdvp(
      form([
        list(valid.rows, { ticker: undefined } as unknown as Partial<KdvpList>),
      ]),
    );
    for (const tag of [
      "<Code>",
      "<F5>",
      "<edp:name>",
      "<TelephoneNumber>",
      "<Email>",
    ]) {
      expect(bare, tag).not.toContain(tag);
    }
    expect(bare).not.toMatch(/<(\w+)><\/\1>/);
  });

  it("writes F5 at its own scale of 4 decimals", () => {
    const gift = writeDohKdvp(
      form([
        list([
          {
            ...purchase("2024-01-02", "1"),
            method: "G",
            inheritanceOrGiftTaxEur: d("12.34565"),
          },
          sale("2026-03-04", "1"),
        ]),
      ]),
    );
    expect(gift).toContain("<F2>G</F2>");
    expect(gift).toContain("<F5>12.3457</F5>");
  });

  it("counts the lists in the KDVP header", () => {
    expect(writeDohKdvp(kdvpDemo2026)).toContain(
      "<SecurityCount>4</SecurityCount>",
    );
  });

  it("refuses a form with issues, naming codes and paths but no values", () => {
    const bad = form([valid], { taxpayer: { taxNumber: "98765" } });
    expect(() => writeDohKdvp(bad)).toThrow(FormValidationError);
    try {
      writeDohKdvp(bad);
    } catch (error) {
      expect(error).toBeInstanceOf(FormValidationError);
      const e = error as FormValidationError;
      expect(e.issues.map((i) => i.code)).toEqual<FormIssueCode[]>([
        "taxNumber",
      ]);
      expect(e.message).not.toContain("98765");
    }
  });
});
