/**
 * The part of a run the CLI and the web app share, on a file ID clash: two
 * different files that hash alike. Chance never makes one, so the hash is
 * replaced here to make it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RateTable } from "@taxreporter/fx";
import { describe, expect, it, vi } from "vitest";

import { prepareReturns } from "./prepare.js";

vi.mock("@taxreporter/core", async (original) => ({
  ...(await original<typeof import("@taxreporter/core")>()),
  fileIdOf: () => "0123456789abcdef",
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
const fixture = (file: string) =>
  read(`packages/brokers/test/fixtures/trading212/${file}`);

describe("prepareReturns", () => {
  it("reads neither of two different files with one ID, and withholds the forms", () => {
    const prepared = prepareReturns({
      files: [
        { name: "a.csv", bytes: fixture("t212-invest-v3-2025.csv") },
        { name: "b.csv", bytes: fixture("t212-invest-v4-2026.csv") },
        { name: "c.csv", bytes: fixture("t212-invest-v3-2025.csv") },
      ],
      taxYear: 2026,
      taxpayer: { taxNumber: "12345678" },
      rates,
      payers: new Map(),
    });
    expect(prepared.clashes).toEqual([{ file: "b.csv", with: "a.csv" }]);
    expect(prepared.repeats).toEqual([{ file: "c.csv", sameAs: "a.csv" }]);
    expect(prepared.imports.map((i) => i.file)).toEqual(["a.csv"]);
    expect(
      prepared.ledger.diagnostics.filter((d) => d.code === "fileIdClash"),
    ).toHaveLength(1);
    expect([prepared.kdvp.form, prepared.div.form]).toEqual([null, null]);
  });
});
