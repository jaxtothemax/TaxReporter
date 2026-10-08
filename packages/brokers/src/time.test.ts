import { taxDate } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { fromUtcStamp } from "./time.js";

/** The date the date policy gives a Trading 212 time. */
const date = (text: string) => {
  const at = fromUtcStamp(text);
  return at === null ? null : (taxDate(at)?.date ?? null);
};

describe("fromUtcStamp", () => {
  it("reads every form Trading 212 has written", () => {
    for (const text of [
      "2026-03-01 01:10:00",
      "2026-03-01 01:10:00.613",
      "2026-03-01 01:10:00+00:00",
      "2026-03-01T01:10:00Z",
    ]) {
      expect(fromUtcStamp(text), text).toEqual({
        instant: "2026-03-01T01:10:00Z",
        brokerDate: "2026-03-01",
      });
    }
  });

  it("keeps the instant to the second, whatever fraction was written", () => {
    expect(fromUtcStamp("2023-12-18 14:30:03.999")?.instant).toBe(
      "2023-12-18T14:30:03Z",
    );
  });

  it("gives the date policy the Ljubljana date of a late-evening UTC time", () => {
    // Winter: UTC+1.
    expect(date("2026-12-31 22:59:59")).toBe("2026-12-31");
    expect(date("2026-12-31 23:00:00")).toBe("2027-01-01");
    // Summer: UTC+2, from 01:00 UTC on 29 March to 01:00 UTC on 25 October.
    expect(date("2026-07-15 22:00:00")).toBe("2026-07-16");
    expect(date("2026-03-28 23:00:00")).toBe("2026-03-29");
    expect(date("2026-03-29 22:00:00")).toBe("2026-03-30");
    expect(date("2026-10-24 22:00:00")).toBe("2026-10-25");
    expect(date("2026-10-25 22:59:59")).toBe("2026-10-25");
  });

  it("refuses anything else, other offsets included", () => {
    for (const text of [
      "",
      "2026-02-30 10:00:00",
      "2026-01-01 24:00:00",
      "2026-01-01 10:60:00",
      "2026-01-01 10:00",
      "2026-01-01 10:00:00+01:00",
      "01/02/2026 10:00:00",
      " 2026-01-01 10:00:00",
      "1969-12-31 23:59:59",
    ]) {
      expect(fromUtcStamp(text), text).toBeNull();
    }
  });
});
