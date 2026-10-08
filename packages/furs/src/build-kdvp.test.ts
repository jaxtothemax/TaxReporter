/**
 * The Doh-KDVP builder: ledger events and the committed BSI snapshot in,
 * inventory lists, F10 and the estimate out. The first suite rebuilds the
 * web demo from its raw trades and has to land on the demo's figures, which
 * were worked out by hand from the same BSI lists (apps/web/src/demo).
 *
 * `UPDATE_GOLDEN=1 pnpm vitest run packages/furs` rewrites the golden file,
 * which goes in the same commit as the rule that changed it.
 */
import { readFileSync, writeFileSync } from "node:fs";

import {
  addDays,
  Decimal,
  type LedgerEvent,
  type SecurityRef,
  type SplitEvent,
  type TradeEvent,
} from "@taxreporter/core";
import { RateTable } from "@taxreporter/fx";
import { describe, expect, it } from "vitest";

import { validateAgainstSchema } from "../test/xsd.js";
import { buildDohKdvp, type KdvpBuild } from "./build-kdvp.js";
import { writeDohKdvp } from "./kdvp.js";

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

const GOLDEN = new URL(
  "../test/fixtures/golden/doh-kdvp-built-demo-2026.xml",
  import.meta.url,
);
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

let row = 0;

function trade(
  security: SecurityRef,
  side: "buy" | "sell",
  date: string,
  quantity: string,
  price: string,
  currency = "EUR",
  broker = "ibkr",
): TradeEvent {
  row += 1;
  return {
    kind: "trade",
    key: `t${String(row)}`,
    broker,
    source: { file: `${broker}.csv`, row },
    side,
    date,
    security,
    quantity: Decimal.parse(quantity),
    price: { amount: Decimal.parse(price), currency },
  };
}

function split(
  security: SecurityRef,
  date: string,
  from: string,
  to: string,
): SplitEvent {
  row += 1;
  return {
    kind: "split",
    key: `s${String(row)}`,
    broker: "ibkr",
    source: { file: "ibkr.csv", row },
    date,
    isin: security.isin,
    from: Decimal.parse(from),
    to: Decimal.parse(to),
  };
}

function build(
  events: readonly LedgerEvent[],
  options: { readonly taxYear?: number; readonly coverageEnd?: string } = {},
): KdvpBuild {
  return buildDohKdvp({
    taxYear: options.taxYear ?? 2026,
    taxpayer: { taxNumber: "12345678" },
    events,
    rates,
    coverageEnd: options.coverageEnd ?? "2027-01-31",
  });
}

const cents = (value: Decimal) => value.toFixed(2, "halfUp");
const units = (value: Decimal) => value.toFixed(8, "halfUp");

/** One list's rows as [kind, date, quantity, EUR per unit, F10]. */
function rowsOf(result: KdvpBuild, isin: string) {
  const built = result.lists.find((l) => l.list.isin === isin);
  if (built === undefined) throw new Error(`no list for ${isin}`);
  return built.list.rows.map((r) =>
    r.kind === "purchase"
      ? [r.kind, r.date, r.quantity.toString(), units(r.unitCostEur)]
      : [
          r.kind,
          r.date,
          r.quantity.toString(),
          units(r.unitValueEur),
          r.lossReducesBase,
        ],
  );
}

const codes = (result: KdvpBuild) => result.diagnostics.map((d) => d.code);

const AAPL: SecurityRef = {
  isin: "US0378331005",
  symbol: "AAPL",
  name: "Apple Inc.",
};
const NVDA: SecurityRef = {
  isin: "US67066G1040",
  symbol: "NVDA",
  name: "NVIDIA Corp.",
};
const VWCE: SecurityRef = {
  isin: "IE00BK5BQT80",
  symbol: "VWCE",
  name: "Vanguard FTSE All-World UCITS ETF (Acc)",
  isFund: true,
};
const ASML: SecurityRef = {
  isin: "NL0010273215",
  symbol: "ASML",
  name: "ASML Holding N.V.",
};
const SAP: SecurityRef = {
  isin: "DE0007164600",
  symbol: "SAP",
  name: "SAP SE",
};

/** The web demo's trades, as the two brokers would export them. */
function demoEvents(): LedgerEvent[] {
  const vwceBuys = [
    ["2024-01-15", "1.3871", "108.14"],
    ["2024-04-15", "1.3304", "112.75"],
    ["2024-07-15", "1.2551", "119.51"],
    ["2024-10-15", "1.2287", "122.08"],
    ["2025-01-15", "1.1102", "135.11"],
    ["2025-04-15", "1.2468", "120.31"],
    ["2025-07-15", "1.1310", "132.63"],
    ["2025-10-15", "1.0745", "139.60"],
  ] as const;
  return [
    trade(AAPL, "buy", "2019-08-14", "10", "201.72", "USD"),
    split(AAPL, "2020-08-31", "1", "4"),
    trade(AAPL, "buy", "2022-03-03", "15", "166.23", "USD"),
    trade(AAPL, "sell", "2026-03-12", "45", "214.87", "USD"),
    trade(NVDA, "buy", "2023-05-02", "2", "287.10", "USD", "trading212"),
    split(NVDA, "2024-06-10", "1", "10"),
    trade(NVDA, "buy", "2024-08-05", "15", "98.91", "USD"),
    trade(NVDA, "sell", "2026-02-11", "25", "178.40", "USD"),
    ...vwceBuys.map(([date, quantity, price]) =>
      trade(VWCE, "buy", date, quantity, price, "EUR", "trading212"),
    ),
    trade(VWCE, "sell", "2026-06-18", "5.2", "141.92", "EUR", "trading212"),
    trade(ASML, "buy", "2025-07-21", "6", "712.40"),
    trade(ASML, "sell", "2026-08-04", "6", "641.15"),
  ];
}

describe("the web demo, rebuilt from raw trades", () => {
  const demo = build(demoEvents());

  it("lists the lots each sale consumes, restated across splits", () => {
    expect(demo.lists.map((l) => l.list.isin)).toEqual([
      VWCE.isin,
      ASML.isin,
      AAPL.isin,
      NVDA.isin,
    ]);
    expect(rowsOf(demo, AAPL.isin)).toEqual([
      ["purchase", "2019-08-14", "40", "45.07508044"],
      ["purchase", "2022-03-03", "5", "150.08125677"],
      ["sale", "2026-03-12", "45", "186.08296527", undefined],
    ]);
    expect(rowsOf(demo, NVDA.isin)).toEqual([
      ["purchase", "2023-05-02", "20", "26.18331053"],
      ["purchase", "2024-08-05", "5", "90.19697246"],
      ["sale", "2026-02-11", "25", "149.91596639", undefined],
    ]);
    // Only the four oldest buys, the last of them in part, leave in 2026.
    expect(rowsOf(demo, VWCE.isin)).toEqual([
      ["purchase", "2024-01-15", "1.3871", "108.14000000"],
      ["purchase", "2024-04-15", "1.3304", "112.75000000"],
      ["purchase", "2024-07-15", "1.2551", "119.51000000"],
      ["purchase", "2024-10-15", "1.2274", "122.08000000"],
      ["sale", "2026-06-18", "5.2", "141.92000000", undefined],
    ]);
    expect(rowsOf(demo, ASML.isin)).toEqual([
      ["purchase", "2025-07-21", "6", "712.40000000"],
      ["sale", "2026-08-04", "6", "641.15000000", true],
    ]);
    const vwce = demo.lists.find((l) => l.list.isin === VWCE.isin)?.list;
    expect([vwce?.ticker, vwce?.isFund]).toEqual(["VWCE", true]);
  });

  it("keeps each row's rate, broker and split with it", () => {
    const aapl = demo.lists.find((l) => l.list.isin === AAPL.isin);
    expect(
      aapl?.rows.map((r) => [
        r.rate.published,
        r.rate.listDate,
        r.rate.source,
        r.broker,
        r.price.amount.toString(),
        r.splitFactor?.toString(),
      ]),
    ).toEqual([
      ["1.1188", "2019-08-14", "bsi-daily", "ibkr", "50.43", "4"],
      ["1.1076", "2022-03-03", "bsi-daily", "ibkr", "166.23", undefined],
      ["1.1547", "2026-03-12", "bsi-daily", "ibkr", "214.87", undefined],
    ]);
    const nvda = demo.lists.find((l) => l.list.isin === NVDA.isin);
    expect(nvda?.rows.map((r) => r.broker)).toEqual([
      "trading212",
      "ibkr",
      "ibkr",
    ]);
  });

  it("values every lot as the demo does", () => {
    expect(
      demo.lists.flatMap((l) =>
        l.lots.map((lot) => [
          lot.purchaseDate,
          lot.quantity.toString(),
          cents(lot.acquisitionEur),
          cents(lot.disposalEur),
          cents(lot.gainEur),
          cents(lot.normedCostsEur),
          lot.yearsHeld,
          lot.bucket,
        ]),
      ),
    ).toEqual([
      ["2024-01-15", "1.3871", "150.00", "196.86", "46.86", "3.47", 2, "25"],
      ["2024-04-15", "1.3304", "150.00", "188.81", "38.81", "3.39", 2, "25"],
      ["2024-07-15", "1.2551", "150.00", "178.12", "28.12", "3.28", 1, "25"],
      ["2024-10-15", "1.2274", "149.84", "174.19", "24.35", "3.24", 1, "25"],
      ["2025-07-21", "6", "4274.40", "3846.90", "-427.50", "0.00", 1, "25"],
      ["2019-08-14", "40", "1803.00", "7443.32", "5640.32", "92.46", 6, "20"],
      ["2022-03-03", "5", "750.41", "930.41", "180.00", "16.81", 4, "25"],
      ["2023-05-02", "20", "523.67", "2998.32", "2474.65", "35.22", 2, "25"],
      ["2024-08-05", "5", "450.98", "749.58", "298.60", "12.01", 1, "25"],
    ]);
  });

  it("estimates the demo's 1,770.04 of tax", () => {
    const { estimate } = demo;
    expect(cents(estimate.positiveByBucket["25"])).toBe("3013.97");
    expect(cents(estimate.positiveByBucket["20"])).toBe("5547.86");
    expect(cents(estimate.losses)).toBe("-427.50");
    expect(cents(estimate.netBase)).toBe("8134.33");
    expect(cents(estimate.allocatedByBucket["25"])).toBe("2863.48");
    expect(cents(estimate.allocatedByBucket["20"])).toBe("5270.85");
    expect(cents(estimate.tax)).toBe("1770.04");
  });

  it("explains the splits and the loss it counts", () => {
    expect(demo.diagnostics.map((d) => [d.severity, d.code, d.params])).toEqual(
      [
        ["info", "lossCounts", { isin: ASML.isin, date: "2026-08-04" }],
        [
          "info",
          "splitAdjusted",
          { isin: AAPL.isin, ratio: "4:1", date: "2020-08-31" },
        ],
        [
          "info",
          "splitAdjusted",
          { isin: NVDA.isin, ratio: "10:1", date: "2024-06-10" },
        ],
      ],
    );
  });

  it(
    "writes the golden file, valid against Doh_KDVP_9.xsd",
    { timeout: 20_000 },
    async () => {
      if (demo.form === null) throw new Error("no form");
      const xml = writeDohKdvp(demo.form);
      if (UPDATE) writeFileSync(GOLDEN, xml);
      expect(xml).toBe(readFileSync(GOLDEN, "utf8"));
      const result = await validateAgainstSchema(xml, "Doh_KDVP_9.xsd");
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    },
  );
});

describe("buildDohKdvp", () => {
  it("lists only what the year's sales consume, net of earlier sales", () => {
    const result = build([
      trade(SAP, "buy", "2024-03-01", "10", "100"),
      trade(SAP, "sell", "2025-05-02", "4", "120"),
      trade(SAP, "buy", "2025-09-01", "5", "110"),
      trade(SAP, "sell", "2026-03-02", "8", "130"),
    ]);
    expect(rowsOf(result, SAP.isin)).toEqual([
      ["purchase", "2024-03-01", "6", "100.00000000"],
      ["purchase", "2025-09-01", "2", "110.00000000"],
      ["sale", "2026-03-02", "8", "130.00000000", undefined],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("leaves lots held 15 years or more off, the anniversary included", () => {
    const result = build([
      trade(SAP, "buy", "2011-03-02", "10", "20"),
      trade(SAP, "buy", "2011-03-03", "10", "50"),
      trade(SAP, "sell", "2026-03-02", "15", "60"),
    ]);
    expect(rowsOf(result, SAP.isin)).toEqual([
      ["purchase", "2011-03-03", "5", "50.00000000"],
      ["sale", "2026-03-02", "5", "60.00000000", undefined],
    ]);
    expect(
      result.lists[0]?.lots.map((lot) => [lot.yearsHeld, lot.bucket]),
    ).toEqual([[14, "15"]]);
    expect(result.diagnostics).toEqual([
      {
        severity: "info",
        code: "exemptLotsLeftOut",
        params: { isin: SAP.isin, quantity: "10" },
      },
    ]);
  });

  it("files nothing when every lot sold is exempt", () => {
    const result = build([
      trade(SAP, "buy", "2010-01-04", "10", "20"),
      trade(SAP, "sell", "2026-03-02", "10", "60"),
    ]);
    expect([result.form, result.lists]).toEqual([null, []]);
    expect(codes(result)).toEqual(["exemptLotsLeftOut"]);
  });

  it("splits a partly replaced loss into a disallowed and an allowed row", () => {
    const result = build([
      trade(SAP, "buy", "2025-01-02", "10", "100"),
      trade(SAP, "sell", "2026-03-02", "10", "80"),
      trade(SAP, "buy", "2026-03-16", "4", "85"),
    ]);
    expect(rowsOf(result, SAP.isin)).toEqual([
      ["purchase", "2025-01-02", "10", "100.00000000"],
      ["sale", "2026-03-02", "4", "80.00000000", false],
      ["sale", "2026-03-02", "6", "80.00000000", true],
    ]);
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      [
        "lossPartlyDisallowed",
        { isin: SAP.isin, date: "2026-03-02", replaced: "4" },
      ],
    ]);
    // Only the 6 shares not replaced may reduce the base.
    expect(cents(result.estimate.losses)).toBe("-120.00");
  });

  it("marks a fully replaced loss as not reducing the base", () => {
    const result = build([
      trade(SAP, "buy", "2025-01-02", "10", "100"),
      trade(SAP, "sell", "2026-03-02", "10", "80"),
      trade(SAP, "buy", "2026-03-20", "10", "85"),
    ]);
    expect(rowsOf(result, SAP.isin).at(-1)).toEqual([
      "sale",
      "2026-03-02",
      "10",
      "80.00000000",
      false,
    ]);
    expect(codes(result)).toEqual(["lossDisallowed"]);
    expect(cents(result.estimate.losses)).toBe("0.00");
  });

  it("leaves F10 out while the files end inside the 30 days after a loss", () => {
    const result = build(
      [
        trade(SAP, "buy", "2025-01-02", "10", "100"),
        trade(SAP, "sell", "2026-12-18", "10", "80"),
      ],
      { coverageEnd: "2026-12-31" },
    );
    expect(rowsOf(result, SAP.isin).at(-1)).toEqual([
      "sale",
      "2026-12-18",
      "10",
      "80.00000000",
      undefined,
    ]);
    expect(result.diagnostics.map((d) => [d.severity, d.params])).toEqual([
      ["warning", { isin: SAP.isin, date: "2026-12-18", until: "2027-01-17" }],
    ]);
    expect(codes(result)).toEqual(["washSaleWindowOpen"]);
    // A warning, not a block; eDavki reads the absent F10 as "Ne".
    expect(result.form).not.toBeNull();
    expect(cents(result.estimate.losses)).toBe("0.00");
  });

  it("decides F10 for a sale whose lots mix a gain and a loss", () => {
    const result = build([
      trade(SAP, "buy", "2025-01-02", "5", "100"),
      trade(SAP, "buy", "2025-06-02", "5", "140"),
      trade(SAP, "sell", "2026-03-02", "10", "120"),
    ]);
    expect(rowsOf(result, SAP.isin).at(-1)).toEqual([
      "sale",
      "2026-03-02",
      "10",
      "120.00000000",
      true,
    ]);
    expect(codes(result)).toEqual(["lossCounts"]);
    // +100 less 11 normed costs, then the 100 loss: nothing to tax.
    const { estimate } = result;
    expect(cents(estimate.positiveByBucket["25"])).toBe("89.00");
    expect(cents(estimate.losses)).toBe("-100.00");
    expect(cents(estimate.tax)).toBe("0.00");
  });

  it("restates rows before a split in the shares of the year's last sale", () => {
    const result = build([
      trade(SAP, "buy", "2025-01-02", "10", "100"),
      trade(SAP, "sell", "2026-02-02", "4", "110"),
      split(SAP, "2026-03-02", "1", "2"),
      trade(SAP, "sell", "2026-04-01", "12", "60"),
    ]);
    expect(rowsOf(result, SAP.isin)).toEqual([
      ["purchase", "2025-01-02", "20", "50.00000000"],
      ["sale", "2026-02-02", "8", "55.00000000", undefined],
      ["sale", "2026-04-01", "12", "60.00000000", undefined],
    ]);
    expect(result.lists[0]?.rows.map((r) => r.splitFactor?.toString())).toEqual(
      ["2", "2", undefined],
    );
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["splitAdjusted", { isin: SAP.isin, ratio: "2:1", date: "2026-03-02" }],
    ]);
  });

  it("rounds quantities past 8 decimals on the running total", () => {
    const result = build([
      trade(SAP, "buy", "2025-01-02", "0.1234567891", "100"),
      trade(SAP, "buy", "2025-02-03", "0.2345678912", "100"),
      trade(SAP, "sell", "2026-03-02", "0.3580246803", "120"),
    ]);
    // 0.12345679 + 0.23456789 = 0.35802468: the stock still ends at zero.
    expect(rowsOf(result, SAP.isin).map((r) => r[2])).toEqual([
      "0.12345679",
      "0.23456789",
      "0.35802468",
    ]);
    expect(codes(result)).toEqual(["quantitiesRounded"]);
    const form = result.form;
    if (form === null) throw new Error("no form");
    expect(() => writeDohKdvp(form)).not.toThrow();
  });

  it("refuses a quantity that rounds to nothing", () => {
    const result = build([
      trade(SAP, "buy", "2025-01-02", "0.000000001", "100"),
      trade(SAP, "sell", "2026-03-02", "0.000000001", "120"),
    ]);
    expect(result.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ["blocking", "quantityTooSmall"],
      ["blocking", "quantityTooSmall"],
    ]);
    expect(result.form).toBeNull();
  });

  it("withholds the form while a rate is missing, and says which", () => {
    // After the snapshot's last day, whenever the snapshot was taken.
    const late = addDays(completeThrough, 30);
    const year = Number(late.slice(0, 4));
    const sale = trade(SAP, "sell", late, "10", "120", "USD");
    const result = build(
      [
        trade(SAP, "buy", `${String(year - 1)}-06-02`, "10", "100", "USD"),
        sale,
      ],
      { taxYear: year, coverageEnd: addDays(late, 31) },
    );
    expect(result.form).toBeNull();
    expect(result.diagnostics).toEqual([
      {
        severity: "blocking",
        code: "rateUnavailable",
        params: { currency: "USD", date: late, reason: "afterSnapshot" },
        source: sale.source,
      },
    ]);
    // The lists still come back, for the review to show what is there.
    expect(result.lists).toHaveLength(1);
  });

  it("blocks on missing history only where this return depends on it", () => {
    const short = build([
      trade(SAP, "buy", "2025-01-02", "3", "100"),
      trade(SAP, "sell", "2026-03-02", "5", "120"),
    ]);
    expect(short.form).toBeNull();
    expect(short.diagnostics.map((d) => [d.code, d.params])).toEqual([
      [
        "insufficientHistory",
        { isin: SAP.isin, date: "2026-03-02", missing: "2" },
      ],
    ]);

    // A shortfall in a security not sold in 2026, and one in a 2027 sale,
    // belong to other years' returns.
    const elsewhere = build([
      trade(ASML, "buy", "2023-01-02", "1", "600"),
      trade(ASML, "sell", "2024-01-02", "2", "620"),
      trade(SAP, "buy", "2025-01-02", "10", "100"),
      trade(SAP, "sell", "2026-03-02", "10", "120"),
      trade(SAP, "sell", "2027-03-01", "5", "130"),
    ]);
    expect(elsewhere.diagnostics).toEqual([]);
    expect(elsewhere.form?.lists.map((l) => l.isin)).toEqual([SAP.isin]);
  });

  it("files nothing for a year without sales", () => {
    const result = build([
      trade(SAP, "buy", "2025-01-02", "10", "100"),
      trade(SAP, "sell", "2025-06-02", "10", "110"),
    ]);
    expect(result).toMatchObject({ form: null, lists: [], diagnostics: [] });
    expect(cents(result.estimate.tax)).toBe("0.00");
  });

  it("notes a BSI rate that differs from the ECB's once per list", () => {
    const equinor: SecurityRef = {
      isin: "NO0010096985",
      symbol: "EQNR",
      name: "Equinor ASA",
    };
    const result = build([
      trade(equinor, "buy", "2025-10-23", "5", "250", "NOK"),
      trade(equinor, "buy", "2025-10-23", "5", "251", "NOK"),
      trade(equinor, "sell", "2026-03-02", "10", "260", "NOK"),
    ]);
    expect(
      result.diagnostics.filter((d) => d.code === "rateDiffersFromEcb"),
    ).toEqual([
      {
        severity: "info",
        code: "rateDiffersFromEcb",
        params: {
          currency: "NOK",
          date: "2025-10-23",
          bsi: "11.8529",
          ecb: "11.5829",
        },
      },
    ]);
    // 250 NOK at BSI's 11.8529, not at the ECB's 11.5829.
    expect(rowsOf(result, equinor.isin)[0]).toEqual([
      "purchase",
      "2025-10-23",
      "5",
      "21.09188469",
    ]);
  });

  it("fits names and tickers to the form: one line, cut by characters", () => {
    const sold = (security: SecurityRef) =>
      build([
        trade(security, "buy", "2025-01-02", "1", "100"),
        trade(security, "sell", "2026-03-02", "1", "120"),
      ]);
    const folded = sold({
      isin: "US02079K3059",
      symbol: "GOOGL.CLASS.A",
      name: " Alphabet\tInc.\n  Class A ",
    }).form?.lists[0];
    expect([folded?.ticker, folded?.name]).toEqual([
      "GOOGL.CLAS",
      "Alphabet Inc. Class A",
    ]);

    // 101 emoji are 202 UTF-16 units; the schema counts 101 characters.
    const emoji = sold({ isin: "US02079K3059", name: "😀".repeat(101) });
    expect(emoji.form?.lists[0]?.name).toBe("😀".repeat(100));
    const form = emoji.form;
    if (form === null) throw new Error("no form");
    expect(() => writeDohKdvp(form)).not.toThrow();

    const blank = sold({ isin: "US02079K3059", symbol: "GOOGL", name: " " });
    expect(blank.form?.lists[0]?.name).toBe("GOOGL");
  });
});
