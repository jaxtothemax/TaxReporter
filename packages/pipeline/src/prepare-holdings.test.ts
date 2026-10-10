/**
 * Holdings are a view beside the returns (ADR-0017): a fault in working
 * them out leaves them out, never the returns. The fault is made here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RateTable } from "@taxreporter/fx";
import { describe, expect, it, vi } from "vitest";

import { prepareReturns } from "./prepare.js";

vi.mock("./holdings.js", () => ({
  buildHoldings: () => {
    throw new Error("a fault no test foresaw");
  },
}));

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

describe("prepareReturns, when the holdings fail", () => {
  it("leaves the holdings out and builds the returns as ever", () => {
    const prepared = prepareReturns({
      // The history the 2026 sales need, as in the CLI's tests.
      files: ["t212-invest-v3-2025.csv", "t212-invest-v4-2026.csv"].map(
        (name) => ({
          name,
          bytes: read(`packages/brokers/test/fixtures/trading212/${name}`),
        }),
      ),
      taxYear: 2026,
      taxpayer: { taxNumber: "12345678" },
      rates,
      payers: new Map(),
    });
    expect(prepared.holdings).toBeNull();
    expect(prepared.kdvp.form).not.toBeNull();
  });
});
