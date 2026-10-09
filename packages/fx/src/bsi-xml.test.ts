import { describe, expect, it } from "vitest";

import { parseDailyXml, parseMonthlyXml } from "./bsi-xml.js";

const DAILY_HEAD =
  '<?xml version="1.0"?><DtecBS xmlns="http://www.bsi.si" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.bsi.si http://www.bsi.si/_data/tecajnice/DTecBS-l.xsd">';
const MONTHLY_HEAD =
  '<?xml version="1.0"?><EksotTecBS xmlns="http://www.bsi.si" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">';

const daily = (body: string) => `${DAILY_HEAD}${body}</DtecBS>`;

describe("parseDailyXml", () => {
  it("reads lists and keeps each rate's string exactly", () => {
    const lists = parseDailyXml(
      daily(
        '<tecajnica datum="2026-10-06"><tecaj oznaka="USD" sifra="840">1.1269</tecaj><tecaj oznaka="GBP" sifra="826">0.84880</tecaj></tecajnica>' +
          '\n<tecajnica datum="2026-10-07"><tecaj oznaka="USD" sifra="840">1.1270</tecaj></tecajnica>',
      ),
    );
    expect(lists.map((l) => l.date)).toEqual(["2026-10-06", "2026-10-07"]);
    expect(lists[0]?.rates.get("GBP")).toBe("0.84880");
    expect(lists[0]?.validFrom).toBeUndefined();
  });

  it("refuses a DOCTYPE, so no entity is ever expanded", () => {
    expect(() =>
      parseDailyXml(`<!DOCTYPE x [<!ENTITY a "b">]>${daily("")}`),
    ).toThrow(/DOCTYPE/);
  });

  it("refuses anything that is not exactly BSI's shape", () => {
    for (const bad of [
      "<html></html>",
      daily(
        '<tecajnica datum="2026-10-06"><tecaj sifra="840" oznaka="USD">1.1</tecaj></tecajnica>',
      ),
      daily(
        '<tecajnica datum="2026-10-06"><tecaj oznaka="USD" sifra="840">1,1</tecaj></tecajnica>',
      ),
      daily(
        '<tecajnica datum="2026-10-06"><tecaj oznaka="USD" sifra="840">1.1</tecaj>',
      ),
      daily('<tecaj oznaka="USD" sifra="840">1.1</tecaj>'),
      daily(
        '<tecajnica datum="2026-10-06"><tecajnica datum="2026-10-07"></tecajnica></tecajnica>',
      ),
      `${daily("")}<extra/>`,
    ]) {
      expect(() => parseDailyXml(bad), bad.slice(-60)).toThrow();
    }
  });

  it("refuses a currency listed twice in one list", () => {
    expect(() =>
      parseDailyXml(
        daily(
          '<tecajnica datum="2026-10-06"><tecaj oznaka="USD" sifra="840">1.1</tecaj><tecaj oznaka="USD" sifra="840">1.2</tecaj></tecajnica>',
        ),
      ),
    ).toThrow(/twice/);
  });
});

describe("parseMonthlyXml", () => {
  it("reads the list date and its validity", () => {
    const [list] = parseMonthlyXml(
      `${MONTHLY_HEAD}<tecajnica datum="2026-09-30" veljavnost="2026-10-01"><tecaj oznaka="TWD" sifra="901">36.917</tecaj></tecajnica></EksotTecBS>`,
    );
    expect([list?.date, list?.validFrom, list?.rates.get("TWD")]).toEqual([
      "2026-09-30",
      "2026-10-01",
      "36.917",
    ]);
  });
});
