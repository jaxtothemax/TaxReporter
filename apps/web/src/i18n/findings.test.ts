import { describe, expect, it } from "vitest";

import { findingsEn, findingsSl, wordsEn, wordsSl } from "./findings";

/** Parameters that name themselves, so every slot shows in the text. */
const named = new Proxy(
  {},
  { get: (_, key) => (typeof key === "string" ? `‹${key}›` : undefined) },
) as never;

describe("the findings catalog", () => {
  it("says every finding in both languages, with every parameter shown", () => {
    for (const catalog of [findingsEn, findingsSl]) {
      for (const [code, message] of Object.entries(catalog)) {
        const text = (message as (p: never) => string)(named);
        expect(text, code).not.toMatch(/undefined|\[object/);
        expect(text.length, code).toBeGreaterThan(10);
      }
    }
    expect(Object.keys(findingsSl).sort()).toEqual(
      Object.keys(findingsEn).sort(),
    );
  });

  it("starts a sentence with a capital when it names no security or day", () => {
    expect(findingsEn.invalidTrade({})).toMatch(/^A trade could not/);
    expect(findingsSl.invalidTrade({})).toMatch(/^Posla ni bilo/);
    expect(
      findingsEn.invalidTrade({ isin: "AAPL", date: "3 Mar 2026" }),
    ).toMatch(/^AAPL, 3 Mar 2026: a trade/);
  });

  it("has the same closed lists in both languages", () => {
    for (const list of [
      "kinds",
      "refusals",
      "csvErrors",
      "rateErrors",
      "brokers",
    ] as const) {
      expect(Object.keys(wordsSl[list]).sort(), list).toEqual(
        Object.keys(wordsEn[list]).sort(),
      );
    }
  });
});
