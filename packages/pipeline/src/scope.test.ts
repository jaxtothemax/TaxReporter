/**
 * A history with a takeover paid in shares and free rights in 2025, and
 * nothing of either sold in 2026 (ADR 0017): its refusals hold back the 2025
 * returns they can change, and leave both 2026 returns to be written. The
 * shape of a real Trading 212 history; every row in the fixture is made up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RateTable } from "@taxreporter/fx";
import { describe, expect, it } from "vitest";

import { prepareReturns } from "./prepare.js";

const root = new URL("../../../", import.meta.url);
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, root)));
const data = (file: string) =>
  read(`packages/fx/data/${file}`).toString("utf8");
const rates = RateTable.fromCsv(
  data("bsi-daily.csv"),
  data("bsi-monthly.csv"),
  (JSON.parse(data("snapshot.json")) as { completeThrough: string })
    .completeThrough,
);

const run = (taxYear: number) =>
  prepareReturns({
    files: [
      {
        name: "history.csv",
        bytes: read(
          "packages/brokers/test/fixtures/trading212/t212-invest-v4-history-takeover.csv",
        ),
      },
    ],
    taxYear,
    taxpayer: { taxNumber: "12345678" },
    rates,
    payers: new Map([
      [
        "US1912161007",
        {
          name: "Coca-Cola",
          address: "Atlanta, Georgia",
          country: "US",
          identificationNumber: "ID-1",
        },
      ],
    ]),
  });

const codes = (findings: readonly { code: string; severity: string }[]) =>
  findings.map((d) => `${d.severity} ${d.code}`);

describe("refusals from one year, preparing the next", () => {
  it("write both 2026 returns, and say why the 2025 rows change nothing", () => {
    const prepared = run(2026);
    expect(prepared.kdvp.form?.lists.map((l) => l.isin)).toEqual([
      "US1912161007",
    ]);
    expect(prepared.div.form?.dividends).toHaveLength(1);
    expect([prepared.scope.kdvp, prepared.scope.div]).toEqual([[], []]);
    expect(
      codes(prepared.scope.findings).filter((c) => c.endsWith("Elsewhere")),
    ).toEqual([
      "info refusedElsewhere",
      "info refusedElsewhere",
      "info refusedElsewhere",
    ]);
    // The ledger itself keeps each refusal as it was: another year reads it.
    expect(
      prepared.ledger.diagnostics.filter((d) => d.severity === "blocking"),
    ).toHaveLength(3);
  });

  it("hold back each 2025 return by the rows that can change it", () => {
    const prepared = run(2025);
    // The sale at 0 is a 2025 disposal; the rights and the new shares might
    // be income. The rights reach no sale within 30 days.
    expect(codes(prepared.scope.kdvp)).toEqual(["blocking invalidPrice"]);
    expect(codes(prepared.scope.div)).toEqual([
      "blocking unsupportedAction",
      "blocking unsupportedAction",
    ]);
    expect([prepared.kdvp.form, prepared.div.form]).toEqual([null, null]);
  });
});
