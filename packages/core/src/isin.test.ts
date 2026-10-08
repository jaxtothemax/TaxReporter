import { describe, expect, it } from "vitest";

import { isIsin } from "./isin.js";

describe("isIsin", () => {
  it("takes ISO 6166 codes with a valid check digit only", () => {
    for (const isin of ["US0378331005", "IE00BK5BQT80", "GB00B10RZP78"]) {
      expect(isIsin(isin), isin).toBe(true);
    }
    for (const value of [
      "US0378331006",
      "us0378331005",
      "US037833100",
      "US03783310055",
      "",
      12345,
      ["US0378331005"],
      null,
    ]) {
      expect(isIsin(value), String(value)).toBe(false);
    }
  });
});
