/**
 * The estimate against the worked examples of
 * docs/research/04-si-tax-rules.md §4.1 and §4.6.
 */
import { describe, expect, it } from "vitest";

import { Decimal } from "./decimal.js";
import { estimateGainsTax, lotBase, type EstimateLot } from "./estimate.js";
import type { HoldingBucket } from "./holding.js";

const lot = (
  acquisition: string,
  disposal: string,
  bucket: HoldingBucket = "25",
  lossReducesBase = true,
): EstimateLot => ({
  bucket,
  acquisitionEur: Decimal.parse(acquisition),
  disposalEur: Decimal.parse(disposal),
  lossReducesBase,
});

const cents = (value: Decimal) => value.toFixed(2, "halfUp");

describe("lotBase", () => {
  it("deducts 1% + 1% normed costs from a gain (FURS: 1,000 to 1,200 gives 178)", () => {
    const base = lotBase(lot("1000.00", "1200.00"));
    expect([
      cents(base.gain),
      cents(base.normedCosts),
      cents(base.base),
    ]).toEqual(["200.00", "22.00", "178.00"]);
  });

  it("caps normed costs at the gain (1,000 to 1,010 gives 0)", () => {
    expect(cents(lotBase(lot("1000.00", "1010.00")).base)).toBe("0.00");
  });

  it("gives a loss no normed costs, and a disallowed loss no weight", () => {
    const loss = lotBase(lot("1000.00", "900.00"));
    expect([cents(loss.normedCosts), cents(loss.base)]).toEqual([
      "0.00",
      "-100.00",
    ]);
    expect(cents(lotBase(lot("1000.00", "900.00", "25", false)).base)).toBe(
      "0.00",
    );
  });
});

describe("estimateGainsTax", () => {
  it("offsets losses and splits the net base pro rata (research 04 §4.6: tax 210)", () => {
    // Bases of exactly +1,000 (under 5 years), +500 (5 to 10) and -600.
    const estimate = estimateGainsTax([
      lot("0.00", "1010.10", "25"),
      lot("0.00", "505.05", "20"),
      lot("600.00", "0.00", "25"),
    ]);
    expect(cents(estimate.positiveByBucket["25"])).toBe("1000.00");
    expect(cents(estimate.positiveByBucket["20"])).toBe("500.00");
    expect(cents(estimate.losses)).toBe("-600.00");
    expect(cents(estimate.netBase)).toBe("900.00");
    expect(cents(estimate.allocatedByBucket["25"])).toBe("600.00");
    expect(cents(estimate.allocatedByBucket["20"])).toBe("300.00");
    expect(cents(estimate.tax)).toBe("210.00");
  });

  it("never carries a net loss: the tax is zero", () => {
    const estimate = estimateGainsTax([
      lot("1000.00", "1100.00"),
      lot("1000.00", "500.00"),
    ]);
    expect(cents(estimate.netBase)).toBe("0.00");
    expect(cents(estimate.tax)).toBe("0.00");
  });

  it("leaves lots held 15 years or more out, gains and losses alike", () => {
    const estimate = estimateGainsTax([
      lot("100.00", "5000.00", "0"),
      lot("100.00", "0.00", "0"),
    ]);
    expect(cents(estimate.tax)).toBe("0.00");
    expect(cents(estimate.losses)).toBe("0.00");
  });

  it("does not let a disallowed loss reduce the year's gains", () => {
    const estimate = estimateGainsTax([
      lot("1000.00", "1200.00"),
      lot("1000.00", "900.00", "25", false),
    ]);
    expect(cents(estimate.netBase)).toBe("178.00");
    expect(cents(estimate.tax)).toBe("44.50");
  });
});
