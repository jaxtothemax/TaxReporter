import { describe, expect, it } from "vitest";

import type { PublishedList } from "./bsi-xml.js";
import { dailyCsv, monthlyCsv, parseSnapshotCsv } from "./snapshot.js";

const list = (
  date: string,
  rates: Record<string, string>,
  validFrom?: string,
): PublishedList => ({
  date,
  ...(validFrom === undefined ? {} : { validFrom }),
  rates: new Map(Object.entries(rates)),
});

describe("dailyCsv", () => {
  it("writes one row per list and one column per currency, gaps empty", () => {
    expect(
      dailyCsv([
        list("2026-10-05", { USD: "1.1269", GBP: "0.84880" }),
        list("2026-10-06", { USD: "1.1270" }),
      ]),
    ).toBe("date,GBP,USD\n2026-10-05,0.84880,1.1269\n2026-10-06,,1.1270\n");
  });

  it("stops on lists out of order, on a weekend, or a changed decimal count", () => {
    expect(() =>
      dailyCsv([list("2026-10-06", {}), list("2026-10-05", {})]),
    ).toThrow(/order/);
    expect(() => dailyCsv([list("2026-10-04", {})])).toThrow(/weekend/);
    expect(() =>
      dailyCsv([
        list("2026-10-05", { USD: "1.1269" }),
        list("2026-10-06", { USD: "1.127" }),
      ]),
    ).toThrow(/Decimal places of USD/);
    // LTL is the one currency BSI wrote with 4 and 5 decimals.
    expect(() =>
      dailyCsv([
        list("2010-10-05", { LTL: "3.4528" }),
        list("2010-10-06", { LTL: "3.45280" }),
      ]),
    ).not.toThrow();
  });
});

describe("monthlyCsv", () => {
  it("merges the split lists BSI published, never overwriting", () => {
    expect(
      monthlyCsv([
        list("2008-06-30", { AAA: "1.5" }, "2008-07-01"),
        list("2008-06-30", { ZWR: "2.5" }, "2008-07-01"),
      ]),
    ).toBe("valid_from,date,AAA,ZWR\n2008-07-01,2008-06-30,1.5,2.5\n");
    expect(() =>
      monthlyCsv([
        list("2008-06-30", { AAA: "1.5" }, "2008-07-01"),
        list("2008-06-30", { AAA: "1.6" }, "2008-07-01"),
      ]),
    ).toThrow(/twice/);
  });

  it("refuses a list valid from anything but the 1st of a month", () => {
    expect(() => monthlyCsv([list("2026-09-30", {}, "2026-10-02")])).toThrow(
      /bad date/,
    );
  });
});

describe("parseSnapshotCsv", () => {
  it("reads a snapshot back", () => {
    const table = parseSnapshotCsv(
      "date,USD\n2026-10-05,1.1269\n2026-10-06,\n",
      "daily",
    );
    expect(table.codes).toEqual(["USD"]);
    expect(table.rows.map((r) => r.rates[0])).toEqual(["1.1269", undefined]);
  });

  it("refuses anything malformed", () => {
    for (const bad of [
      "when,USD\n",
      "date,usd\n",
      "date,USD\n2026-10-05\n",
      "date,USD\n2026-10-06,1\n2026-10-05,1\n",
      "date,USD\n2026-10-05,1e3\n",
    ]) {
      expect(
        () => parseSnapshotCsv(bad, "daily"),
        JSON.stringify(bad),
      ).toThrow();
    }
    expect(() =>
      parseSnapshotCsv("valid_from,date\n2026-10-01,nope\n", "monthly"),
    ).toThrow();
  });
});
