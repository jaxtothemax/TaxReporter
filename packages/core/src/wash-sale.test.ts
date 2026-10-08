/**
 * The 30-day rule as FURS reads it (docs/research/04-si-tax-rules.md §5.3);
 * each case names the FURS examples the research cites for it.
 */
import { describe, expect, it } from "vitest";

import { ISIN, split, trade } from "../test/events.js";
import { Decimal } from "./decimal.js";
import { matchFifo } from "./fifo.js";
import type { LedgerEvent } from "./ledger.js";
import { washSaleVerdicts } from "./wash-sale.js";

/** Verdicts for the sales on `lossDates`, all treated as losses. */
function verdicts(
  events: LedgerEvent[],
  lossDates: string[],
  coverageEnd = "2026-12-31",
) {
  const history = matchFifo(events).securities.get(ISIN);
  if (history === undefined) throw new Error("no history");
  const losses = history.disposals.filter((x) =>
    lossDates.includes(x.sale.date),
  );
  const result = washSaleVerdicts(
    history,
    losses.map((disposal) => ({ disposal, quantity: disposal.sale.quantity })),
    coverageEnd,
  );
  return losses.map((x) => {
    const verdict = result.get(x.sale);
    return [x.sale.date, verdict?.status, verdict?.replaced.toString()];
  });
}

describe("washSaleVerdicts", () => {
  it("allows a loss with no purchase in the 61-day window", () => {
    expect(
      verdicts(
        [
          trade("buy", "2025-01-02", "10"),
          trade("sell", "2026-03-01", "10"),
          trade("buy", "2026-04-01", "10"),
        ],
        ["2026-03-01"],
      ),
    ).toEqual([["2026-03-01", "allowed", "0"]]);
  });

  it("disallows a loss replaced within 30 days after the sale (examples 9, 20, 21)", () => {
    expect(
      verdicts(
        [
          trade("buy", "2025-01-02", "10"),
          trade("sell", "2026-03-01", "10"),
          trade("buy", "2026-03-31", "10"),
        ],
        ["2026-03-01"],
      ),
    ).toEqual([["2026-03-01", "disallowed", "10"]]);
  });

  it("disallows a loss while another lot bought in the 30 days before is still held", () => {
    expect(
      verdicts(
        [
          trade("buy", "2025-01-02", "10"),
          trade("buy", "2026-02-20", "10"),
          trade("sell", "2026-03-01", "10"),
        ],
        ["2026-03-01"],
      ),
    ).toEqual([["2026-03-01", "disallowed", "10"]]);
  });

  it("keeps the whole loss when the sale empties the position, window lots included (examples 14, 18)", () => {
    expect(
      verdicts(
        [
          trade("buy", "2025-01-02", "10"),
          trade("buy", "2026-02-20", "10"),
          trade("sell", "2026-03-01", "20"),
        ],
        ["2026-03-01"],
      ),
    ).toEqual([["2026-03-01", "allowed", "0"]]);
  });

  it("never counts the unsold rest of the lot being sold (examples 2, 3, 7)", () => {
    expect(
      verdicts(
        [trade("buy", "2026-02-20", "10"), trade("sell", "2026-03-01", "4")],
        ["2026-03-01"],
      ),
    ).toEqual([["2026-03-01", "allowed", "0"]]);
  });

  it("disallows only the replaced quantity", () => {
    expect(
      verdicts(
        [
          trade("buy", "2025-01-02", "10"),
          trade("sell", "2026-03-01", "10"),
          trade("buy", "2026-03-15", "4"),
        ],
        ["2026-03-01"],
      ),
    ).toEqual([["2026-03-01", "partial", "4"]]);
  });

  it("lets each purchase replace only once, in date order (examples 11, 16, 17, 19)", () => {
    expect(
      verdicts(
        [
          trade("buy", "2025-01-02", "20"),
          trade("sell", "2026-03-01", "10"),
          trade("sell", "2026-03-05", "10"),
          trade("buy", "2026-03-20", "10"),
        ],
        ["2026-03-05", "2026-03-01"],
      ),
    ).toEqual([
      ["2026-03-01", "disallowed", "10"],
      ["2026-03-05", "allowed", "0"],
    ]);
  });

  it("leaves the verdict open while the files end inside the window", () => {
    const events = [
      trade("buy", "2025-01-02", "10"),
      trade("sell", "2026-12-20", "10"),
    ];
    expect(verdicts(events, ["2026-12-20"], "2026-12-31")).toEqual([
      ["2026-12-20", "undetermined", "0"],
    ]);
    // A replacement already in the files decides it, open window or not.
    expect(
      verdicts(
        [...events, trade("buy", "2026-12-28", "10")],
        ["2026-12-20"],
        "2026-12-31",
      ),
    ).toEqual([["2026-12-20", "disallowed", "10"]]);
  });

  it("needs replacing only the shares sold at a loss", () => {
    const history = matchFifo([
      trade("buy", "2025-01-02", "20"),
      trade("sell", "2026-03-01", "15"),
      trade("buy", "2026-03-10", "5"),
    ]).securities.get(ISIN);
    if (history === undefined) throw new Error("no history");
    const [disposal] = history.disposals;
    if (disposal === undefined) throw new Error("no sale");
    // 5 of the 15 shares were sold at a loss: 5 bought back cover them all.
    const verdict = washSaleVerdicts(
      history,
      [{ disposal, quantity: Decimal.parse("5") }],
      "2026-12-31",
    ).get(disposal.sale);
    expect([verdict?.status, verdict?.replaced.toString()]).toEqual([
      "disallowed",
      "5",
    ]);
  });

  it("counts a replacement bought at another broker under the same key", () => {
    // Keys are unique only within a broker: Trading 212's purchase "t1"
    // is not IBKR's sale "t1", and it still replaces the loss.
    const buy = trade("buy", "2025-01-02", "10", "100", { key: "t1" });
    const sale = trade("sell", "2026-03-01", "10", "80", { key: "t2" });
    const replacement = trade("buy", "2026-03-10", "10", "85", {
      key: "t1",
      broker: "trading212",
      source: { file: "t212.csv", row: 1 },
    });
    const history = matchFifo([buy, sale, replacement]).securities.get(ISIN);
    if (history === undefined) throw new Error("no history");
    const [disposal] = history.disposals;
    if (disposal === undefined) throw new Error("no sale");
    const verdict = washSaleVerdicts(
      history,
      [{ disposal, quantity: disposal.sale.quantity }],
      "2026-12-31",
    ).get(disposal.sale);
    expect([verdict?.status, verdict?.replaced.toString()]).toEqual([
      "disallowed",
      "10",
    ]);
  });

  it("refuses a coverage date it cannot compare", () => {
    const history = matchFifo([trade("buy", "2025-01-02", "1")]).securities.get(
      ISIN,
    );
    if (history === undefined) throw new Error("no history");
    expect(() => washSaleVerdicts(history, [], "2026-1-5")).toThrow(RangeError);
  });

  it("compares quantities across a split in between", () => {
    expect(
      verdicts(
        [
          trade("buy", "2025-01-02", "10"),
          trade("sell", "2026-03-01", "10"),
          split("2026-03-06", "1", "2"),
          trade("buy", "2026-03-11", "20"),
        ],
        ["2026-03-01"],
      ),
    ).toEqual([["2026-03-01", "disallowed", "10"]]);
  });
});
