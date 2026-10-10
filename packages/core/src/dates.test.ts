import { describe, expect, it } from "vitest";

import { instantMillis, isIsoDate, ljubljanaDate, taxDate } from "./dates.js";

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

describe("instantMillis", () => {
  it("reads a UTC instant to the second", () => {
    expect(instantMillis("1970-01-01T00:00:01Z")).toBe(1000);
    expect(instantMillis("2024-02-29T23:59:59Z")).toBe(
      Date.UTC(2024, 1, 29, 23, 59, 59),
    );
  });

  it("refuses times that do not exist, offsets and other forms", () => {
    for (const value of [
      "2025-02-29T10:00:00Z",
      "2025-01-01T24:00:00Z",
      "2025-01-01T10:60:00Z",
      "2025-01-01T10:00:00+01:00",
      "2025-01-01T10:00:00",
      "2025-01-01 10:00:00Z",
      "1969-12-31T23:59:59Z",
    ]) {
      expect(instantMillis(value), value).toBeNull();
    }
  });
});

describe("ljubljanaDate", () => {
  it("adds one hour in winter, two in summer", () => {
    // New Year's Eve: the hour that moves a trade into the next tax year.
    expect(ljubljanaDate("2025-12-31T22:59:59Z")).toBe("2025-12-31");
    expect(ljubljanaDate("2025-12-31T23:00:00Z")).toBe("2026-01-01");
    expect(ljubljanaDate("2025-07-01T21:59:59Z")).toBe("2025-07-01");
    expect(ljubljanaDate("2025-07-01T22:00:00Z")).toBe("2025-07-02");
  });

  it("changes offset at 01:00 UTC on the last Sundays of March and October", () => {
    // 2025: 30 March and 26 October.
    expect(ljubljanaDate("2025-03-29T22:59:59Z")).toBe("2025-03-29");
    expect(ljubljanaDate("2025-03-29T23:00:00Z")).toBe("2025-03-30");
    expect(ljubljanaDate("2025-03-30T22:00:00Z")).toBe("2025-03-31");
    expect(ljubljanaDate("2025-10-25T21:59:59Z")).toBe("2025-10-25");
    expect(ljubljanaDate("2025-10-25T22:00:00Z")).toBe("2025-10-26");
    expect(ljubljanaDate("2025-10-26T22:59:59Z")).toBe("2025-10-26");
    expect(ljubljanaDate("2025-10-26T23:00:00Z")).toBe("2025-10-27");
  });

  it("gives no date for an instant it cannot read", () => {
    expect(ljubljanaDate("2025-12-31")).toBeNull();
  });

  it("gives no date past year 9999, where the date would have five digits", () => {
    expect(ljubljanaDate("9999-12-31T22:59:59Z")).toBe("9999-12-31");
    expect(ljubljanaDate("9999-12-31T23:30:00Z")).toBeNull();
    expect(
      taxDate({ instant: "9999-12-31T23:30:00Z", brokerDate: null }),
    ).toBeNull();
  });
});

describe("taxDate", () => {
  it("takes the Ljubljana date of the broker's instant, and says when it moved", () => {
    expect(
      taxDate({ instant: "2025-01-01T23:30:00Z", brokerDate: "2025-01-01" }),
    ).toEqual({ date: "2025-01-02", moved: true });
    expect(
      taxDate({ instant: "2025-01-01T12:00:00Z", brokerDate: "2025-01-01" }),
    ).toEqual({ date: "2025-01-01", moved: false });
    expect(
      taxDate({ instant: "2025-01-01T23:30:00Z", brokerDate: null }),
    ).toEqual({ date: "2025-01-02", moved: false });
  });

  it("takes the broker's own date as it is where there is no instant", () => {
    expect(taxDate({ instant: null, brokerDate: "2026-04-01" })).toEqual({
      date: "2026-04-01",
      moved: false,
    });
  });

  it("gives no date for a clock it cannot read", () => {
    expect(taxDate({ instant: null, brokerDate: null })).toBeNull();
    expect(taxDate({ instant: "today", brokerDate: "2025-01-01" })).toBeNull();
    expect(
      taxDate({ instant: "2025-01-01T12:00:00Z", brokerDate: "2025-1-1" }),
    ).toBeNull();
    expect(taxDate({ instant: null, brokerDate: "2025-02-30" })).toBeNull();
  });
});
