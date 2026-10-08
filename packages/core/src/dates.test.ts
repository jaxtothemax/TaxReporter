import { describe, expect, it } from "vitest";

import { isIsoDate } from "./dates.js";

describe("isIsoDate", () => {
  it("takes real calendar dates written as YYYY-MM-DD", () => {
    expect(isIsoDate("2026-03-12")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("refuses impossible dates, other forms and non-strings", () => {
    for (const value of [
      "2025-02-29",
      "2026-13-01",
      "2026-1-5",
      "2026-03-12T10:00:00",
      "12.03.2026",
      "0999-12-31",
      ["2026-03-12"],
      20260312,
      null,
    ]) {
      expect(isIsoDate(value), String(value)).toBe(false);
    }
  });
});
