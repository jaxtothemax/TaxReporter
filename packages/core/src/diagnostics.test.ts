import { describe, expect, it } from "vitest";

import {
  diagnostic,
  forExport,
  hasBlocking,
  untrusted,
  UNTRUSTED_LENGTH,
} from "./diagnostics.js";
import { LIMITS } from "./limits.js";

describe("untrusted", () => {
  it("wraps file text, cut to its limit without splitting a character", () => {
    expect(untrusted("Bonus")).toEqual({ untrusted: "Bonus" });
    const long = untrusted("x".repeat(UNTRUSTED_LENGTH - 1) + "😀😀");
    expect(Array.from(long.untrusted)).toHaveLength(UNTRUSTED_LENGTH);
    expect(Object.isFrozen(long)).toBe(true);
  });

  it("never renders as its text by accident", () => {
    const wrapped: unknown = untrusted("Janez Novak");
    expect(String(wrapped)).toBe("[object Object]");
  });
});

describe("forExport", () => {
  it("drops the source and every piece of file text", () => {
    const d = diagnostic(
      "blocking",
      "unknownColumn",
      { broker: "trading212", position: 18, column: untrusted("Janez Novak") },
      { file: "Janez_Novak_U1234567.csv", row: 1 },
    );
    const exported = forExport(d);
    expect(exported).toEqual({
      severity: "blocking",
      code: "unknownColumn",
      params: { broker: "trading212", position: 18 },
    });
    expect(JSON.stringify(exported)).not.toMatch(/Janez|U1234567/);
  });

  it("keeps a diagnostic's typed values as they are", () => {
    expect(
      forExport(diagnostic("info", "duplicatesRemoved", { count: 3 })),
    ).toEqual({
      severity: "info",
      code: "duplicatesRemoved",
      params: { count: 3 },
    });
    expect(hasBlocking([diagnostic("warning", "invalidTime", {})])).toBe(false);
  });
});

describe("LIMITS", () => {
  it("is one frozen table", () => {
    expect(Object.isFrozen(LIMITS)).toBe(true);
    expect(LIMITS.fileBytes).toBe(64 * 1024 * 1024);
  });
});
