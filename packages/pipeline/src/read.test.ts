/**
 * The two halves of a run: reading needs no taxpayer and no rates, and the
 * halves together build exactly what `prepareReturns` builds.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { writeDohDiv, writeDohKdvp } from "@taxreporter/furs";
import { RateTable } from "@taxreporter/fx";
import { describe, expect, it } from "vitest";

import { buildReturns, prepareReturns, readExports } from "./prepare.js";

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
const fixtures = "packages/brokers/test/fixtures";
const files = [
  ["a.csv", `${fixtures}/trading212/t212-invest-v3-2025.csv`],
  ["b.csv", `${fixtures}/trading212/t212-invest-v4-2026.csv`],
  ["c.xml", `${fixtures}/ibkr/flex-activity-2025-2026.xml`],
].map(([name = "", path = ""]) => ({ name, bytes: read(path) }));

const build = {
  taxYear: 2026,
  taxpayer: { taxNumber: "12345678" },
  rates,
  payers: new Map([
    [
      "US1912161007",
      {
        name: "The Coca-Cola Company",
        address: "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
        country: "US" as const,
      },
    ],
  ]),
};

describe("readExports", () => {
  it("reads every file and checks the events, with no taxpayer or rates", () => {
    const exports = readExports({ files });
    expect(
      exports.imports.map((i) => [i.file, i.result.broker, i.result.format]),
    ).toEqual([
      ["a.csv", "trading212", "trading212-csv-v3"],
      ["b.csv", "trading212", "trading212-csv-v4"],
      ["c.xml", "ibkr", "ibkr-flex-xml"],
    ]);
    expect(
      exports.ledger.diagnostics.filter((d) => d.severity === "blocking"),
    ).toEqual([]);
    expect(exports.ledger.events.length).toBeGreaterThan(0);
  });
});

describe("buildReturns", () => {
  it("builds from what was read exactly what prepareReturns builds", () => {
    const halves = buildReturns(readExports({ files }), build);
    const whole = prepareReturns({ files, ...build });
    const xml = (p: typeof whole) => [
      p.kdvp.form === null ? null : writeDohKdvp(p.kdvp.form),
      p.div.form === null ? null : writeDohDiv(p.div.form),
    ];
    expect(xml(halves)).toEqual(xml(whole));
    expect(xml(halves)).not.toContain(null);
    expect(halves.coverageEnd).toBe(whole.coverageEnd);
  });
});
