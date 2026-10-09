import { describe, expect, it } from "vitest";

import {
  diagnostic,
  fileRef,
  forExport,
  hasBlocking,
  isFileRef,
  untrusted,
  UNTRUSTED_LENGTH,
} from "./diagnostics.js";
import type { FileId } from "./ledger.js";
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
      { fileId: "0123456789abcdef" as FileId, row: 1 },
    );
    const exported = forExport(d);
    expect(exported).not.toHaveProperty("source");
    expect(exported).toEqual({
      severity: "blocking",
      code: "unknownColumn",
      params: { broker: "trading212", position: 18 },
    });
    expect(JSON.stringify(exported)).not.toMatch(/Janez|U1234567/);
  });

  it("drops the files a finding names, which only the screen may name", () => {
    const file = "0123456789abcdef" as FileId;
    const d = diagnostic("blocking", "overlapMismatch", {
      kind: "trade",
      from: "2026-02-03",
      to: "2026-02-10",
      first: fileRef(file),
      second: fileRef(file),
    });
    if (d.code !== "overlapMismatch") throw new Error("another code");
    expect(isFileRef(d.params.first)).toBe(true);
    expect(forExport(d).params).toEqual({
      kind: "trade",
      from: "2026-02-03",
      to: "2026-02-10",
    });
    expect(JSON.stringify(forExport(d))).not.toContain(file);
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
    // A session holds a few files at the per-file cap, not the cap 100 times.
    expect(LIMITS.sessionBytes).toBe(256 * 1024 * 1024);
    expect(LIMITS.sessionBytes).toBeGreaterThan(LIMITS.fileBytes);
  });
});
