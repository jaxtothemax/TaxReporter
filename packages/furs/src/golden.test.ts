/**
 * Golden files: the exact bytes eDavki will import, one per scenario in
 * test/scenarios.ts. Each is compared byte for byte with what the writer
 * produces now, and validated against the vendored schema it claims.
 *
 * `UPDATE_GOLDEN=1 pnpm vitest run packages/furs` rewrites them. A changed
 * golden file goes in the same commit as the rule or source that changed it
 * (CLAUDE.md, "Testing conventions").
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GOLDEN } from "../test/scenarios.js";
import { validateAgainstSchema } from "../test/xsd.js";
import { writeDohDiv } from "./div.js";
import { writeDohKdvp } from "./kdvp.js";

const DIR = new URL("../test/fixtures/golden/", import.meta.url);
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

const SCHEMA = { kdvp: "Doh_KDVP_9.xsd", div: "Doh_Div_3.xsd" } as const;

describe.each(Object.entries(GOLDEN))("%s", (file, entry) => {
  const url = new URL(file, DIR);
  const written =
    entry.form === "kdvp"
      ? writeDohKdvp(entry.model)
      : writeDohDiv(entry.model);

  it("matches the golden file byte for byte", () => {
    if (UPDATE) writeFileSync(url, written);
    expect(existsSync(url), `missing golden file ${file}`).toBe(true);
    expect(written).toBe(readFileSync(url, "utf8"));
  });

  it(
    `validates against ${SCHEMA[entry.form]}`,
    { timeout: 20_000 },
    async () => {
      const result = await validateAgainstSchema(
        readFileSync(url, "utf8"),
        SCHEMA[entry.form],
      );
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    },
  );
});

describe("schema validation", () => {
  // Proves the check can fail: each document breaks one rule the schema
  // enforces, so a validator that accepted anything would be caught here.
  // Built from the writer's own output, not the golden files, so this runs
  // even while UPDATE_GOLDEN rewrites them.
  const kdvp = writeDohKdvp(GOLDEN["doh-kdvp-matched-lots.xml"].model);
  const div = writeDohDiv(GOLDEN["doh-div-research-example.xml"].model);
  type Break = readonly [string, (xml: string) => string];

  it.each<Break>([
    ["nine decimals in F4", (x) => x.replace("158.48329049", "158.483290491")],
    [
      "F7 before F6",
      (x) => x.replace(/(<F6>[^<]+<\/F6>)(\s*)(<F7>[^<]+<\/F7>)/, "$3$2$1"),
    ],
    [
      "an F2 code the schema lacks",
      (x) => x.replace("<F2>B</F2>", "<F2>Z</F2>"),
    ],
    ["a seven-digit tax number", (x) => x.replace("12345678", "1234567")],
    ["no edp:Signatures", (x) => x.replace("<edp:Signatures/>", "")],
  ])("rejects Doh-KDVP with %s", { timeout: 20_000 }, async (_name, change) => {
    const broken = change(kdvp);
    expect(broken).not.toBe(kdvp);
    expect((await validateAgainstSchema(broken, SCHEMA.kdvp)).valid).toBe(
      false,
    );
  });

  it.each<Break>([
    [
      "three decimals in Value",
      (x) => x.replace("<Value>22.22</Value>", "<Value>22.222</Value>"),
    ],
    [
      "Value before Type",
      (x) =>
        x.replace(/(<Type>1<\/Type>)(\s*)(<Value>22\.22<\/Value>)/, "$3$2$1"),
    ],
    [
      "edp:bodyContent in the body",
      (x) => x.replace("<body>", "<body><edp:bodyContent/>"),
    ],
  ])("rejects Doh-Div with %s", { timeout: 20_000 }, async (_name, change) => {
    const broken = change(div);
    expect(broken).not.toBe(div);
    expect((await validateAgainstSchema(broken, SCHEMA.div)).valid).toBe(false);
  });
});
