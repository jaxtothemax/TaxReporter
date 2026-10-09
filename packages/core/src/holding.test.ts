import { describe, expect, it } from "vitest";

import { addDays, bucketFor, completedYears, daysBetween } from "./holding.js";

describe("holding periods", () => {
  it("counts completed years, the anniversary completing one", () => {
    expect(completedYears("2021-03-12", "2026-03-11")).toBe(4);
    expect(completedYears("2021-03-12", "2026-03-12")).toBe(5);
    expect(completedYears("2019-08-14", "2026-03-12")).toBe(6);
    expect(completedYears("2024-02-29", "2025-02-28")).toBe(0);
  });

  it("maps years to the rate buckets of ZDoh-2 Art. 132", () => {
    expect([0, 4, 5, 9, 10, 14, 15, 30].map(bucketFor)).toEqual([
      "25",
      "25",
      "20",
      "20",
      "15",
      "15",
      "0",
      "0",
    ]);
  });

  it("does calendar arithmetic in UTC days", () => {
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-03-01", -30)).toBe("2026-01-30");
    expect(daysBetween("2026-03-29", "2026-03-30")).toBe(1);
  });
});
