/**
 * The whole pipeline on the synthetic Trading 212 history
 * (packages/brokers/test/fixtures/trading212): exports in, Doh-KDVP and
 * Doh-Div out. Each stage has its own tests; this one proves the stages fit,
 * that what the adapter emits is what the ledger, the engine and the
 * builders take.
 */
import { readFileSync } from "node:fs";

import { importFile } from "@taxreporter/brokers";
import { fileIdOf, validateLedger } from "@taxreporter/core";
import {
  buildDohDiv,
  buildDohKdvp,
  writeDohDiv,
  writeDohKdvp,
  type PayerInfo,
} from "@taxreporter/furs";
import { RateTable } from "@taxreporter/fx";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const { completeThrough } = JSON.parse(
  read("packages/fx/data/snapshot.json"),
) as { completeThrough: string };
const rates = RateTable.fromCsv(
  read("packages/fx/data/bsi-daily.csv"),
  read("packages/fx/data/bsi-monthly.csv"),
  completeThrough,
);

const exports = ["t212-invest-v3-2025.csv", "t212-invest-v4-2026.csv"].map(
  (file) => {
    const bytes = readFileSync(
      new URL(`packages/brokers/test/fixtures/trading212/${file}`, root),
    );
    return importFile({ bytes, fileId: fileIdOf(bytes), accountGroup: 1 });
  },
);
const ledger = validateLedger(
  exports.flatMap((e) => e.events),
  exports.flatMap((e) => e.diagnostics),
);
const taxpayer = { taxNumber: "12345678" };

describe("Trading 212 exports to eDavki XML", () => {
  it("imports both years with nothing blocking", () => {
    expect(exports.map((e) => e.format)).toEqual([
      "trading212-csv-v3",
      "trading212-csv-v4",
    ]);
    expect(ledger.diagnostics.filter((d) => d.severity !== "info")).toEqual([
      {
        severity: "warning",
        code: "interestNotCovered",
        params: { broker: "trading212", count: 1 },
      },
    ]);
  });

  it("builds Doh-KDVP for 2026 from the adapter's events", () => {
    const kdvp = buildDohKdvp({
      taxYear: 2026,
      taxpayer,
      ledger,
      rates,
      coverageEnd: "2026-09-10",
    });
    expect(kdvp.diagnostics.filter((d) => d.severity === "blocking")).toEqual(
      [],
    );
    const form = kdvp.form;
    if (form === null) throw new Error("no form");
    expect(
      form.lists.map((l) => [
        l.isin,
        l.isFund,
        l.rows.map((r) => [r.kind, r.date, r.quantity.toString()]),
      ]),
    ).toEqual([
      [
        "IE00BK5BQT80",
        true,
        [
          // 10 decimals in the export, 8 on the form.
          ["purchase", "2025-03-17", "1.23456789"],
          ["sale", "2026-06-18", "1.23456789"],
        ],
      ],
      [
        "US00000ACME1",
        false,
        [
          // 3 bought in 2025, restated as 9 after the 3:1 split of March.
          ["purchase", "2025-02-04", "9"],
          ["sale", "2026-09-10", "9"],
        ],
      ],
      [
        "US1912161007",
        false,
        [
          ["purchase", "2026-01-06", "8"],
          ["sale", "2026-05-15", "8"],
        ],
      ],
    ]);
    expect(kdvp.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(["quantitiesRounded", "splitAdjusted"]),
    );
    expect(() => writeDohKdvp(form)).not.toThrow();
  });

  it("builds Doh-Div for 2026 from the adapter's dividend and its tax", () => {
    const coca: PayerInfo = {
      name: "The Coca-Cola Company",
      address: "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
      country: "US",
    };
    const div = buildDohDiv({
      taxYear: 2026,
      taxpayer,
      ledger,
      rates,
      payers: new Map([["US1912161007", coca]]),
    });
    const form = div.form;
    if (form === null) throw new Error("no form");
    const [record] = form.dividends;
    // 20 x 0.4335 net + 1.53 withheld = 10.20 USD gross.
    expect([
      record?.date,
      record?.type,
      record?.sourceCountry,
      record?.payer.identificationNumber,
    ]).toEqual(["2026-04-01", "1", "US", "US1912161007"]);
    const usd = rates.lookup("USD", "2026-04-01");
    if (!usd.ok) throw new Error("no rate");
    expect(div.dividends[0]?.grossEur.toString()).toBe(
      centsAt("10.20", usd.rate.published),
    );
    expect(() => writeDohDiv(form)).not.toThrow();
  });
});

/** USD at a published BSI rate, in cents, computed the long way. */
function centsAt(usd: string, rate: string): string {
  const [whole = "0", fraction = ""] = usd.split(".");
  const amount = BigInt(whole + fraction.padEnd(2, "0"));
  const [rw = "0", rf = ""] = rate.split(".");
  const r = BigInt(rw + rf);
  // cents = amount(cents) / rate, with the rate's decimals moved over.
  const scaled = amount * 10n ** BigInt(rf.length);
  const cents = (scaled * 2n + r) / (2n * r);
  return `${String(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
}
