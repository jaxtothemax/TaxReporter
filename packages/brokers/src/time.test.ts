import { describe, expect, it } from "vitest";

import { fromUtcStamp } from "./time.js";

const date = (text: string) => fromUtcStamp(text)?.date ?? null;

describe("fromUtcStamp", () => {
  it("reads every form Trading 212 has written", () => {
    expect(date("2020-06-24 04:06:06")).toBe("2020-06-24");
    expect(date("2023-12-18 14:30:03.613")).toBe("2023-12-18");
    expect(date("2026-03-01 01:10:00+00:00")).toBe("2026-03-01");
    expect(date("2026-03-01T01:10:00Z")).toBe("2026-03-01");
  });

  it("moves a late-evening UTC time to the next day in Ljubljana", () => {
    // Winter: UTC+1.
    expect(date("2026-12-31 22:59:59")).toBe("2026-12-31");
    expect(date("2026-12-31 23:00:00")).toBe("2027-01-01");
    // Summer: UTC+2.
    expect(date("2026-07-15 21:59:59")).toBe("2026-07-15");
    expect(date("2026-07-15 22:00:00")).toBe("2026-07-16");
  });

  it("switches to summer time at 01:00 UTC on the last Sunday of March", () => {
    // 29 March 2026 is that Sunday.
    expect(date("2026-03-28 23:00:00")).toBe("2026-03-29"); // UTC+1
    expect(date("2026-03-29 00:59:59")).toBe("2026-03-29"); // still UTC+1
    expect(date("2026-03-29 22:00:00")).toBe("2026-03-30"); // UTC+2
    expect(date("2026-03-29 21:59:59")).toBe("2026-03-29");
  });

  it("switches back at 01:00 UTC on the last Sunday of October", () => {
    // 25 October 2026 is that Sunday.
    expect(date("2026-10-24 22:00:00")).toBe("2026-10-25"); // UTC+2
    expect(date("2026-10-25 22:59:59")).toBe("2026-10-25"); // UTC+1
    expect(date("2026-10-25 23:00:00")).toBe("2026-10-26");
  });

  it("keeps the UTC date beside the Ljubljana one", () => {
    expect(fromUtcStamp("2026-07-15 22:30:00")).toMatchObject({
      date: "2026-07-16",
      utcDate: "2026-07-15",
    });
  });

  it("keeps the instant to the second, whatever fraction was written", () => {
    expect(fromUtcStamp("2023-12-18 14:30:03.613")?.second).toBe(
      "2023-12-18T14:30:03Z",
    );
    expect(fromUtcStamp("2023-12-18 14:30:03+00:00")?.second).toBe(
      "2023-12-18T14:30:03Z",
    );
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
