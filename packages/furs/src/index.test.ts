import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "../package.json" with { type: "json" };
import { PACKAGE } from "./index.js";

const SCHEMAS = new URL("../schemas/", import.meta.url);

// Named here rather than derived from the README, so deleting a schema together
// with its README row still fails this test instead of shrinking it.
const VENDORED = [
  "D_IFI_4.xsd",
  "Doh_Div_3.xsd",
  "Doh_KDVP_9.xsd",
  "Doh_Obr_2.xsd",
  "EDP-Common-1.xsd",
];

/** `file -> SHA-256`, read from the table in schemas/README.md. */
function readmePins(): Map<string, string> {
  const pins = new Map<string, string>();
  const readme = readFileSync(new URL("README.md", SCHEMAS), "utf8");
  for (const line of readme.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .map((cell) => cell.trim().replaceAll("`", ""));
    const file = cells.find((cell) => /^[\w-]+\.xsd$/.test(cell));
    const sha256 = cells.find((cell) => /^[0-9a-f]{64}$/.test(cell));
    if (file !== undefined && sha256 !== undefined) pins.set(file, sha256);
  }
  return pins;
}

const PINS = readmePins();

describe("@taxreporter/furs", () => {
  it("identifies itself by the name its package.json publishes", () => {
    expect(PACKAGE).toBe(manifest.name);
  });

  it("vendors exactly the schemas schemas/README.md pins, no more and no fewer", () => {
    expect([...PINS.keys()].toSorted()).toEqual(VENDORED);
    const onDisk = readdirSync(SCHEMAS).filter((name) => name.endsWith(".xsd"));
    expect(onDisk.toSorted()).toEqual(VENDORED);
  });

  // A mismatch means the bytes changed: a line-ending normalization slipped
  // past .gitattributes, or someone re-downloaded a schema FURS edited in place
  // without updating its pin. Either way the README no longer describes the file.
  it.each(VENDORED)(
    "%s still has the SHA-256 pinned in schemas/README.md",
    (file) => {
      const bytes = readFileSync(new URL(file, SCHEMAS));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        PINS.get(file),
      );
    },
  );
});
