import { describe, expect, it } from "vitest";

import {
  addDays,
  bucketFor,
  completedYears,
  daysBetween,
  holdingOutlook,
} from "./holding.js";

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

describe("holdingOutlook", () => {
  it("dates the next bucket the day after the anniversary", () => {
    expect(holdingOutlook("2021-03-12", "2026-01-31")).toEqual({
      bucket: "25",
      next: { bucket: "20", from: "2026-03-13" },
    });
    expect(holdingOutlook("2019-08-14", "2026-10-01")).toEqual({
      bucket: "20",
      next: { bucket: "15", from: "2029-08-15" },
    });
    expect(holdingOutlook("2012-05-02", "2026-10-01")).toEqual({
      bucket: "15",
      next: { bucket: "0", from: "2027-05-03" },
    });
  });

  it("shows the higher rate on the anniversary itself, and the lower from the day after", () => {
    // completedYears counts the anniversary complete; FURS has not said so.
    expect(completedYears("2021-03-12", "2026-03-12")).toBe(5);
    expect(holdingOutlook("2021-03-12", "2026-03-12")).toEqual({
      bucket: "25",
      next: { bucket: "20", from: "2026-03-13" },
    });
    expect(holdingOutlook("2021-03-12", "2026-03-13")).toEqual({
      bucket: "20",
      next: { bucket: "15", from: "2031-03-13" },
    });
  });

  it("has no next bucket once exempt", () => {
    expect(holdingOutlook("2010-01-04", "2026-10-01")).toEqual({
      bucket: "0",
      next: null,
    });
  });

  it("takes a 29 February purchase's anniversary as 1 March outside a leap year", () => {
    expect(holdingOutlook("2024-02-29", "2026-10-01").next).toEqual({
      bucket: "20",
      from: "2029-03-02",
    });
    // Five, ten and fifteen years after a leap year are never leap years.
    expect(holdingOutlook("2016-02-29", "2026-10-01").next).toEqual({
      bucket: "0",
      from: "2031-03-02",
    });
  });

  it("gives a date that is in the next bucket under either reading, and a day before it that is not", () => {
    const acquired = [
      "2020-01-01",
      "2020-02-29",
      "2021-12-31",
      "2019-06-30",
      "2011-07-15",
    ];
    for (const date of acquired) {
      let asOf = date;
      for (let step = 0; step < 4; step += 1) {
        const { next } = holdingOutlook(date, asOf);
        if (next === null) break;
        const before = addDays(next.from, -1);
        // Both readings: the anniversary completing the year, or not.
        expect(bucketFor(completedYears(date, next.from))).toBe(next.bucket);
        expect(bucketFor(completedYears(date, before))).toBe(next.bucket);
        expect(bucketFor(completedYears(date, addDays(before, -1)))).not.toBe(
          next.bucket,
        );
        asOf = next.from;
      }
    }
  });

  it("gives no next bucket where its day would be past year 9999", () => {
    // Any year to 9999 passes import: a hostile file must not crash a run.
    expect(holdingOutlook("9995-06-01", "9996-01-01")).toEqual({
      bucket: "25",
      next: null,
    });
    expect(holdingOutlook("9990-01-01", "9999-12-31")).toEqual({
      bucket: "20",
      next: null,
    });
    expect(holdingOutlook("9994-12-31", "9995-01-01").next).toBeNull();
    expect(holdingOutlook("9994-12-30", "9995-01-01").next).toEqual({
      bucket: "20",
      from: "9999-12-31",
    });
    expect(holdingOutlook("1000-01-01", "1000-01-01").bucket).toBe("25");
  });

  it("refuses a date that is not one", () => {
    expect(() => holdingOutlook("10000-01-01", "2026-01-01")).toThrow(
      RangeError,
    );
    expect(() => holdingOutlook("2026-01-01", "2026-02-30")).toThrow(
      RangeError,
    );
  });
});
