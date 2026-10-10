import { describe, expect, it } from "vitest";

import { account, ISIN, split, trade, validated } from "../test/events.js";
import { matchFifo } from "./fifo.js";
import { accountPositions } from "./holdings.js";
import type { AccountScope, IsoDate, LedgerEvent } from "./ledger.js";

const IBKR = account("ibkr");
const T212 = account("trading212");

/** Positions with FIFO's merged splits, as the pipeline calls it. */
function positions(
  events: readonly LedgerEvent[],
  asOf: ReadonlyMap<AccountScope, IsoDate> = new Map(),
) {
  const ledger = validated(events);
  const splits = new Map(
    [...matchFifo(ledger).securities].map(([isin, h]) => [isin, h.splits]),
  );
  return accountPositions(ledger, splits, asOf).map((p) => [
    p.account,
    p.isin,
    p.quantity.toString(),
  ]);
}

describe("accountPositions", () => {
  it("keeps each account's own shares where FIFO matched across accounts", () => {
    const events = [
      trade("buy", "2024-01-02", "10", "100", { broker: "trading212" }),
      trade("buy", "2025-02-03", "10"),
      trade("sell", "2026-03-02", "10"),
    ];
    // FIFO sells the older Trading 212 lot, wherever the sale was made.
    const fifo = matchFifo(validated(events)).securities.get(ISIN);
    expect(fifo?.open.map((l) => l.purchase.broker)).toEqual(["ibkr"]);
    // The broker shows its own account: the IBKR shares are gone.
    expect(positions(events)).toEqual([[T212, ISIN, "10"]]);
  });

  it("restates for a split up to the account's own last day, whoever reported it", () => {
    const events = [
      trade("buy", "2019-08-14", "10", "200", { broker: "trading212" }),
      trade("buy", "2019-09-02", "3"),
      split("2020-08-31", "1", "4"),
    ];
    expect(
      positions(
        events,
        new Map([
          [IBKR, "2026-10-01"],
          [T212, "2026-09-30"],
        ]),
      ),
    ).toEqual([
      [IBKR, ISIN, "12"],
      [T212, ISIN, "40"],
    ]);
    // An account whose files end before the split is shown in old shares.
    expect(positions(events, new Map([[T212, "2020-08-30"]]))).toEqual([
      [IBKR, ISIN, "12"],
      [T212, ISIN, "10"],
    ]);
  });

  it("counts a trade on the split's own day in new shares", () => {
    expect(
      positions([
        trade("buy", "2024-06-01", "10"),
        split("2024-06-10", "1", "2"),
        trade("sell", "2024-06-10", "5"),
      ]),
    ).toEqual([[IBKR, ISIN, "15"]]);
  });

  it("keeps a negative position and leaves out a closed one", () => {
    expect(
      positions([
        trade("buy", "2024-01-02", "10", "100", { broker: "trading212" }),
        trade("sell", "2025-01-02", "10", "100", { broker: "trading212" }),
        // Shares moved in from elsewhere, sold here: no purchase in this account.
        trade("buy", "2023-01-02", "4"),
        trade("sell", "2026-03-02", "6"),
      ]),
    ).toEqual([[IBKR, ISIN, "-2"]]);
  });

  it("reads an account through its last covered day only", () => {
    expect(
      positions(
        [trade("buy", "2024-01-02", "10"), trade("sell", "2026-11-02", "4")],
        new Map([[IBKR, "2026-10-31"]]),
      ),
    ).toEqual([[IBKR, ISIN, "10"]]);
  });

  it("gives the same positions whatever order the events come in", () => {
    const events = [
      trade("buy", "2019-08-14", "10", "200", { broker: "trading212" }),
      split("2020-08-31", "1", "4"),
      trade("buy", "2021-01-04", "7"),
      trade("sell", "2026-03-02", "15", "100", { broker: "trading212" }),
    ];
    expect(positions([...events].reverse())).toEqual(positions(events));
  });
});
