/**
 * The Doh-Div builder: a validated ledger of dividends and the tax withheld
 * on them, and the committed BSI snapshot in, one record per payment and the
 * estimate out. The first suite
 * rebuilds the web demo's dividends from raw events: the XML has to equal
 * the golden file written from the hand-made model (test/scenarios.ts), and
 * the estimate the demo's figures.
 */
import { readFileSync } from "node:fs";

import {
  addDays,
  Decimal,
  validateLedger,
  type DividendEvent,
  type LedgerEvent,
  type SecurityRef,
  type WithholdingEvent,
} from "@taxreporter/core";
import { RateTable } from "@taxreporter/fx";
import { describe, expect, it } from "vitest";

import { account, fileId, key, onDate, validated } from "../test/events.js";
import {
  ALLIANZ,
  APPLE,
  ATT,
  REALTY_INCOME,
  TAXPAYER,
  UNILEVER,
} from "../test/scenarios.js";
import { buildDohDiv, type DivBuild, type PayerInfo } from "./build-div.js";
import { writeDohDiv } from "./div.js";

const data = (file: string) =>
  readFileSync(new URL(`../../fx/data/${file}`, import.meta.url), "utf8");
const { completeThrough } = JSON.parse(data("snapshot.json")) as {
  completeThrough: string;
};
const rates = RateTable.fromCsv(
  data("bsi-daily.csv"),
  data("bsi-monthly.csv"),
  completeThrough,
);

let row = 0;

function dividend(
  security: SecurityRef,
  date: string,
  gross: string,
  currency = "USD",
  broker = "ibkr",
): DividendEvent {
  row += 1;
  return {
    kind: "dividend",
    key: key(row),
    broker,
    account: account(broker),
    source: { fileId: fileId(broker), row },
    at: onDate(date),
    date,
    security,
    gross: { amount: Decimal.parse(gross), currency },
  };
}

function withholding(
  of: DividendEvent,
  amount: string,
  date = of.date,
  overrides: Partial<WithholdingEvent> = {},
): WithholdingEvent {
  row += 1;
  return {
    kind: "withholding",
    key: key(row),
    broker: of.broker,
    account: of.account,
    source: { fileId: fileId(of.broker), row },
    at: onDate(date),
    date,
    isin: of.security.isin,
    dividendKey: of.key,
    amount: { amount: Decimal.parse(amount), currency: of.gross.currency },
    ...overrides,
  };
}

/** A dividend and the tax withheld on it, booked together. */
const paid = (
  security: SecurityRef,
  date: string,
  gross: string,
  tax: string,
  currency = "USD",
  broker = "ibkr",
) => {
  const event = dividend(security, date, gross, currency, broker);
  return [event, withholding(event, tax)];
};

const AAPL: SecurityRef = {
  isin: "US0378331005",
  symbol: "AAPL",
  name: "Apple Inc.",
};
const O: SecurityRef = {
  isin: "US7561091049",
  symbol: "O",
  name: "Realty Income Corp.",
};
const T: SecurityRef = { isin: "US00206R1023", symbol: "T", name: "AT&T Inc." };
const ULVR: SecurityRef = {
  isin: "GB00B10RZP78",
  symbol: "ULVR",
  name: "Unilever PLC",
};
const ALV: SecurityRef = {
  isin: "DE0008404005",
  symbol: "ALV",
  name: "Allianz SE",
};

const PAYERS = new Map<string, PayerInfo>([
  [AAPL.isin, APPLE],
  [O.isin, REALTY_INCOME],
  [T.isin, ATT],
  [ULVR.isin, UNILEVER],
  [ALV.isin, ALLIANZ],
]);

function build(
  events: readonly LedgerEvent[],
  options: {
    readonly taxYear?: number;
    readonly payers?: ReadonlyMap<string, PayerInfo>;
    readonly treatyRates?: ReadonlyMap<string, Decimal>;
  } = {},
): DivBuild {
  return buildDohDiv({
    taxYear: options.taxYear ?? 2026,
    taxpayer: TAXPAYER,
    ledger: validated(events),
    rates,
    payers: options.payers ?? PAYERS,
    ...(options.treatyRates === undefined
      ? {}
      : { treatyRates: options.treatyRates }),
  });
}

const cents = (value: Decimal) => value.toFixed(2, "halfUp");
const codes = (result: DivBuild) => result.diagnostics.map((d) => d.code);

/** The web demo's dividends, as the two brokers would export them. */
function demoEvents(): LedgerEvent[] {
  return [
    ...paid(O, "2026-01-15", "3.23", "0.48", "USD", "trading212"),
    ...paid(AAPL, "2026-02-12", "14.30", "2.14"),
    ...paid(O, "2026-02-13", "3.23", "0.48", "USD", "trading212"),
    ...paid(O, "2026-03-13", "3.23", "0.48", "USD", "trading212"),
    // Nothing withheld: no withholding event at all.
    dividend(ULVR, "2026-03-20", "17.43", "GBP", "trading212"),
    // 1 May is a TARGET holiday: the 30 April list applies.
    ...paid(T, "2026-05-01", "16.65", "2.49"),
    ...paid(ALV, "2026-05-08", "123.20", "32.49", "EUR"),
    ...paid(AAPL, "2026-05-14", "2.70", "0.40"),
    ...paid(AAPL, "2026-08-13", "2.70", "0.40"),
  ];
}

describe("the web demo's dividends, rebuilt from raw events", () => {
  // The demo assumes Germany's treaty rate, which the built-in table does
  // not carry until docs/research sources it.
  const demo = build(demoEvents(), {
    treatyRates: new Map([["DE", Decimal.parse("0.15")]]),
  });

  it("writes exactly the golden file of the hand-made model", () => {
    if (demo.form === null) throw new Error("no form");
    const golden = new URL(
      "../test/fixtures/golden/doh-div-demo-2026.xml",
      import.meta.url,
    );
    expect(writeDohDiv(demo.form)).toBe(readFileSync(golden, "utf8"));
  });

  it("converts each payment at its own date's rate and caps each credit", () => {
    expect(
      demo.dividends.map((d) => [
        d.date,
        d.security.symbol,
        d.rate.published,
        cents(d.grossEur),
        cents(d.foreignTaxEur),
        cents(d.credit.credit),
        d.treatyRate?.toString() ?? null,
      ]),
    ).toEqual([
      ["2026-01-15", "O", "1.1624", "2.78", "0.41", "0.41", "0.15"],
      ["2026-02-12", "AAPL", "1.1874", "12.04", "1.80", "1.80", "0.15"],
      ["2026-02-13", "O", "1.1862", "2.72", "0.40", "0.40", "0.15"],
      ["2026-03-13", "O", "1.1476", "2.81", "0.42", "0.42", "0.15"],
      ["2026-03-20", "ULVR", "0.86438", "20.16", "0.00", "0.00", null],
      ["2026-05-01", "T", "1.1702", "14.23", "2.13", "2.13", "0.15"],
      ["2026-05-08", "ALV", "1", "123.20", "32.49", "18.48", "0.15"],
      ["2026-05-14", "AAPL", "1.1702", "2.31", "0.34", "0.34", "0.15"],
      ["2026-08-13", "AAPL", "1.1534", "2.34", "0.35", "0.35", "0.15"],
    ]);
    expect(demo.dividends[5]?.rate.listDate).toBe("2026-04-30");
  });

  it("estimates the demo's 21.33 still due", () => {
    const { estimate } = demo;
    expect(
      [
        estimate.taxRate,
        estimate.grossEur,
        estimate.foreignTaxEur,
        estimate.creditEur,
        estimate.taxDueEur,
      ].map((v) => v.toString()),
    ).toEqual(["0.25", "182.59", "38.34", "24.33", "21.33"]);
  });

  it("says what Germany withheld above the treaty rate", () => {
    expect(demo.diagnostics).toEqual([
      {
        severity: "warning",
        code: "excessWithholding",
        params: {
          isin: ALV.isin,
          date: "2026-05-08",
          country: "DE",
          withheldEur: "32.49",
          treatyRate: "0.15",
          creditEur: "18.48",
          excessEur: "14.01",
        },
        source: { fileId: fileId("ibkr"), row: expect.any(Number) as number },
      },
    ]);
  });
});

describe("buildDohDiv", () => {
  it("warns where no treaty rate is known, crediting up to the Slovenian tax", () => {
    const result = build(paid(ALV, "2026-05-08", "123.20", "32.49", "EUR"));
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["treatyRateUnknown", { country: "DE" }],
    ]);
    expect(cents(result.dividends[0]?.credit.credit ?? Decimal.ZERO)).toBe(
      "30.80",
    );
  });

  it("nets a reversal against the tax it reverses, at the payment date's rate", () => {
    const event = dividend(AAPL, "2026-03-02", "10.00");
    const result = build([
      event,
      withholding(event, "3.00"),
      withholding(event, "-1.50", "2026-04-15"),
    ]);
    const usd = rates.lookup("USD", "2026-03-02");
    if (!usd.ok) throw new Error("no rate");
    const [built] = result.dividends;
    expect(built?.withholdings.map((w) => w.amount.toString())).toEqual([
      "3",
      "-1.5",
    ]);
    expect(built?.foreignTaxEur.toString()).toBe(
      cents(Decimal.parse("1.50").dividedBy(usd.rate.rate)),
    );
    expect(result.form).not.toBeNull();
  });

  it("refuses tax it cannot tie to its dividend", () => {
    const event = dividend(AAPL, "2026-03-02", "10.00");
    const orphan = withholding(event, "1.50", "2026-03-02", {
      dividendKey: key(0xdead),
    });
    const mismatched = withholding(event, "1.50", "2026-03-02", {
      isin: O.isin,
    });
    const result = build([event, orphan, mismatched]);
    expect(result.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ["blocking", "withholdingWithoutDividend"],
      ["blocking", "withholdingIsinMismatch"],
    ]);
    expect(result.form).toBeNull();
  });

  it("points a reversal of last year's tax at last year's return", () => {
    const last = dividend(AAPL, "2025-12-15", "10.00");
    const result = build([
      last,
      withholding(last, "1.50"),
      withholding(last, "-1.50", "2026-02-02"),
    ]);
    expect(result.diagnostics.map((d) => [d.severity, d.params])).toEqual([
      [
        "warning",
        { isin: AAPL.isin, date: "2026-02-02", dividendDate: "2025-12-15" },
      ],
    ]);
    expect(codes(result)).toEqual(["withholdingForOtherYear"]);
    expect(result.form).toBeNull();
  });

  it("refuses more tax reversed than withheld", () => {
    const event = dividend(AAPL, "2026-03-02", "10.00");
    const result = build([
      event,
      withholding(event, "1.00"),
      withholding(event, "-2.00", "2026-04-15"),
    ]);
    expect(codes(result)).toEqual(["foreignTaxNegative"]);
    expect(result.form).toBeNull();
  });

  it("asks once per security for a payer it does not know", () => {
    const result = build(
      [
        ...paid(AAPL, "2026-02-12", "14.30", "2.14"),
        ...paid(AAPL, "2026-05-14", "2.70", "0.40"),
      ],
      { payers: new Map() },
    );
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["payerUnknown", { isin: AAPL.isin }],
    ]);
    // Still listed, with their amounts, for the review to ask about.
    expect(result.dividends.map((d) => [d.record, cents(d.grossEur)])).toEqual([
      [null, "12.04"],
      [null, "2.31"],
    ]);
    expect(result.form).toBeNull();
  });

  it("takes the source country from the ISIN, or from the payer where it names none", () => {
    const greek: SecurityRef = { isin: "GRS419003009", name: "OPAP S.A." };
    const bond: SecurityRef = { isin: "XS1234567896", name: "A note" };
    const payer = (name: string, country: PayerInfo["country"]) => ({
      name,
      address: "Somewhere 1",
      country,
      identificationNumber: "ID-1",
    });
    const unknown = build([dividend(bond, "2026-03-02", "5.00", "EUR")], {
      payers: new Map([[bond.isin, payer("Issuer", "LU")]]),
    });
    expect(unknown.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["sourceCountryUnknown", { isin: bond.isin }],
    ]);
    const stated = build([dividend(bond, "2026-03-02", "5.00", "EUR")], {
      payers: new Map([
        [bond.isin, { ...payer("Issuer", "LU"), sourceCountry: "LU" }],
      ]),
    });
    expect(stated.form?.dividends[0]?.sourceCountry).toBe("LU");
    // Greece is EL on FURS's list, not GR.
    const opap = build([dividend(greek, "2026-03-02", "5.00", "EUR")], {
      payers: new Map([[greek.isin, payer("OPAP S.A.", "EL")]]),
    });
    expect(opap.form?.dividends[0]?.sourceCountry).toBe("EL");
  });

  it("types a fund's distribution 4 and a share's dividend 1", () => {
    const fund: SecurityRef = {
      isin: "IE00B3RBWM25",
      name: "Vanguard FTSE All-World UCITS ETF (Dist)",
      isFund: true,
    };
    const result = build(
      [
        dividend(fund, "2026-03-25", "15.00", "USD", "trading212"),
        ...paid(AAPL, "2026-05-14", "2.70", "0.40"),
      ],
      {
        payers: new Map([
          ...PAYERS,
          [
            fund.isin,
            {
              name: "Vanguard Funds plc",
              address: "70 Sir John Rogerson's Quay, Dublin 2, Ireland",
              country: "IE",
            },
          ],
        ]),
      },
    );
    expect(result.form?.dividends.map((d) => d.type)).toEqual(["4", "1"]);
  });

  it("numbers the records of one payer ID on one day, as FURS advises", () => {
    // An ordinary and a special dividend paid on the same day.
    const result = build([
      ...paid(AAPL, "2026-05-14", "2.70", "0.40"),
      ...paid(AAPL, "2026-05-14", "10.00", "1.50"),
      ...paid(T, "2026-05-14", "16.65", "2.49"),
    ]);
    expect(
      result.form?.dividends.map((d) => d.payer.identificationNumber),
    ).toEqual([T.isin, "1", "2"]);
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["payerIdsNumbered", { date: "2026-05-14", count: 2 }],
    ]);
    const form = result.form;
    if (form === null) throw new Error("no form");
    expect(() => writeDohDiv(form)).not.toThrow();
  });

  it("puts the ISIN in place of a foreign payer's missing ID, and says so once", () => {
    const { identificationNumber, ...withoutId } = APPLE;
    expect(identificationNumber).toBeDefined();
    const result = build(
      [
        ...paid(AAPL, "2026-02-12", "14.30", "2.14"),
        ...paid(AAPL, "2026-05-14", "2.70", "0.40"),
      ],
      { payers: new Map([[AAPL.isin, withoutId]]) },
    );
    expect(
      result.form?.dividends.map((d) => d.payer.identificationNumber),
    ).toEqual([AAPL.isin, AAPL.isin]);
    expect(codes(result)).toEqual(["payerIdIsIsin"]);
  });

  it("warns that a Slovenian payer's dividend may not belong on Doh-Div", () => {
    const krka: SecurityRef = { isin: "SI0031102120", name: "Krka, d. d." };
    const result = build([dividend(krka, "2026-07-10", "50.00", "EUR")], {
      payers: new Map([
        [
          krka.isin,
          {
            name: "Krka, d. d.",
            address: "Šmarješka cesta 6, 8501 Novo mesto",
            country: "SI",
            taxNumber: "87654321",
          },
        ],
      ]),
    });
    expect(codes(result)).toEqual(["slovenianPayer"]);
    const form = result.form;
    if (form === null) throw new Error("no form");
    expect(writeDohDiv(form)).not.toContain("<ForeignTax>");
  });

  it("refuses a dividend that is not positive", () => {
    const result = build([dividend(AAPL, "2026-03-02", "0")]);
    expect(result.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ["blocking", "dividendNotPositive"],
    ]);
  });

  it("withholds the form while a rate is missing", () => {
    const late = addDays(completeThrough, 30);
    const result = build([dividend(AAPL, late, "10.00")], {
      taxYear: Number(late.slice(0, 4)),
    });
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      [
        "rateUnavailable",
        { currency: "USD", date: late, reason: "afterSnapshot" },
      ],
    ]);
    expect(result.form).toBeNull();
  });

  it("keeps one record of a payment read from two overlapping exports", () => {
    const [event, tax] = paid(AAPL, "2026-02-12", "14.30", "2.14");
    if (event === undefined || tax === undefined) throw new Error("no events");
    const again = { source: { fileId: fileId("b"), row: 9 } };
    const ledger = validateLedger([
      event,
      tax,
      { ...event, ...again },
      { ...tax, ...again },
    ]);
    expect(ledger.diagnostics.map((d) => d.code)).toEqual([
      "duplicatesRemoved",
    ]);
    const result = buildDohDiv({
      taxYear: 2026,
      taxpayer: TAXPAYER,
      ledger,
      rates,
      payers: PAYERS,
    });
    expect(result.form?.dividends).toHaveLength(1);
    expect(result.dividends[0]?.withholdings).toHaveLength(1);
    expect(codes(result)).toEqual([]);
  });

  it("turns a payer's broken details into a blocking finding", () => {
    const result = build(paid(AAPL, "2026-02-12", "14.30", "2.14"), {
      payers: new Map([[AAPL.isin, { ...APPLE, address: "Line 1\nLine 2" }]]),
    });
    expect(result.diagnostics).toEqual([
      {
        severity: "blocking",
        code: "formIssue",
        params: {
          code: "invalidCharacter",
          path: "dividends[0].payer.address",
        },
      },
    ]);
    expect(result.form).toBeNull();
  });

  it("withholds the form while the ledger's own checks block", () => {
    const good = paid(AAPL, "2026-03-02", "10.00", "1.50");
    const bad = {
      ...dividend(AAPL, "2026-03-03", "10.00"),
      gross: { amount: Decimal.parse("10"), currency: "U1234567" },
    };
    const ledger = validateLedger([...good, bad]);
    expect(ledger.diagnostics.map((d) => d.code)).toEqual(["invalidDividend"]);
    const result = buildDohDiv({
      taxYear: 2026,
      taxpayer: TAXPAYER,
      ledger,
      rates,
      payers: PAYERS,
    });
    // The good payment is there to review; the form waits for the bad one.
    expect(codes(result)).toEqual([]);
    expect(result.dividends).toHaveLength(1);
    expect(result.form).toBeNull();
  });

  it("keeps two accounts' dividends apart, even under one key", () => {
    const ibkr = dividend(AAPL, "2026-03-02", "10.00");
    const t212 = {
      ...ibkr,
      broker: "trading212",
      account: account("trading212"),
      source: { fileId: fileId("trading212"), row: 1 },
    };
    const result = build([ibkr, t212]);
    expect(result.dividends).toHaveLength(2);
  });

  it("joins tax to its dividend within the dividend's own account", () => {
    const ibkr = dividend(AAPL, "2026-03-02", "10.00");
    const other = {
      ...ibkr,
      account: account("ibkr", 2),
      source: { fileId: fileId("b"), row: 1 },
    };
    // Withheld in account 2, on its dividend under the same key.
    const tax = {
      ...withholding(ibkr, "1.50"),
      account: other.account,
      source: { fileId: fileId("b"), row: 2 },
    };
    // Two accounts paid alike: a warning, and each keeps its own tax.
    const ledger = validateLedger([ibkr, other, tax]);
    expect(ledger.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ["warning", "accountsShareEvents"],
    ]);
    const result = buildDohDiv({
      taxYear: 2026,
      taxpayer: TAXPAYER,
      ledger,
      rates,
      payers: PAYERS,
    });
    const taxBy = new Map(
      result.dividends.map((d) => [
        d.source.fileId === fileId("b") ? "b" : "main",
        d.withholdings.map((w) => w.amount.toString()),
      ]),
    );
    expect(Object.fromEntries(taxBy)).toEqual({ main: [], b: ["1.5"] });
  });

  it("refuses a tax year it cannot use", () => {
    expect(() => build([], { taxYear: 2026.5 })).toThrow(RangeError);
  });

  it("files nothing for a year without dividends", () => {
    const result = build(paid(AAPL, "2025-02-12", "14.30", "2.14"));
    expect(result).toMatchObject({
      form: null,
      dividends: [],
      diagnostics: [],
    });
    expect(result.estimate.taxDueEur.toString()).toBe("0");
  });
});
