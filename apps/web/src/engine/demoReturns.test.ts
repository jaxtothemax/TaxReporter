/**
 * The demo's returns, written in the browser by the engine and the writers
 * the command line uses. They have to be the golden files the builders'
 * tests check against FURS's schemas: the Doh-Div file byte for byte, and
 * the Doh-KDVP file in every inventory list. Its golden file was written for
 * a taxpayer known only by tax number, so the header and the contact fields
 * differ there, and are checked on their own.
 */
import { describe, expect, it } from "vitest";

import divGolden from "../../../../packages/furs/test/fixtures/golden/doh-div-demo-2026.xml?raw";
import kdvpGolden from "../../../../packages/furs/test/fixtures/golden/doh-kdvp-built-demo-2026.xml?raw";
import { DEMO_TAXPAYER } from "../demo/demoLedger";
import { buildDemoReturns } from "./demoReturns";

/** Every inventory list: the lots, the dates, the quantities, the values. */
const lists = (xml: string) => xml.slice(xml.indexOf("<KDVPItem>"));

describe("buildDemoReturns", () => {
  it("writes the demo's Doh-KDVP and Doh-Div as the golden files hold them", async () => {
    const { kdvp, div } = await buildDemoReturns();
    expect([kdvp.fileName, kdvp.blocking]).toEqual(["Doh_KDVP_2026.xml", 0]);
    expect([div.fileName, div.blocking]).toEqual(["Doh_Div_2026.xml", 0]);
    if (kdvp.xml === null || div.xml === null) throw new Error("no XML");
    expect(lists(kdvp.xml)).toBe(lists(kdvpGolden));
    expect(lists(kdvp.xml)).toContain("<KDVPItem>");
    for (const field of [
      `<edp:taxNumber>${DEMO_TAXPAYER.taxNumber}</edp:taxNumber>`,
      "<edp:name>Janez Novak</edp:name>",
      "<SecurityCount>4</SecurityCount>",
      "<Email>janez.novak@example.com</Email>",
    ]) {
      expect(kdvp.xml).toContain(field);
    }
    expect(div.xml).toBe(divGolden);
  });

  it("never puts anything but the made-up taxpayer in a demo file", async () => {
    const { kdvp, div } = await buildDemoReturns();
    for (const xml of [kdvp.xml, div.xml]) {
      expect(xml).toContain("<edp:taxNumber>12345678</edp:taxNumber>");
      expect(xml?.match(/<edp:taxNumber>/g)).toHaveLength(1);
    }
  });
});
