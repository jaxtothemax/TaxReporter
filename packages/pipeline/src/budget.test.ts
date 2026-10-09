/**
 * The session's byte budget, with LIMITS.sessionBytes made small: a file
 * past it is not read, and the session is refused, never built short.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { readExports } from "./prepare.js";

const root = new URL("../../../", import.meta.url);
const fixture = (file: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`packages/brokers/test/fixtures/trading212/${file}`, root),
    ),
  );
const a = fixture("t212-invest-v3-2025.csv");
const b = fixture("t212-invest-v4-2026.csv");

// Hoisted above the fixtures: a budget between the first file (1,144
// bytes) and both together (2,951), checked below.
const BUDGET = vi.hoisted(() => 2000);

vi.mock("@taxreporter/core", async (original) => {
  const core = await original<typeof import("@taxreporter/core")>();
  return {
    ...core,
    LIMITS: Object.freeze({ ...core.LIMITS, sessionBytes: BUDGET }),
  };
});

describe("readExports: the session's bytes", () => {
  it("reads no file past the budget, and refuses the session", () => {
    // Room for the first file and not for both.
    expect(a.length).toBeLessThan(BUDGET);
    expect(a.length + b.length).toBeGreaterThan(BUDGET);
    const read = readExports({
      files: [
        { name: "a.csv", bytes: a },
        { name: "b.csv", bytes: b },
      ],
    });
    expect(read.imports.map((i) => i.file)).toEqual(["a.csv"]);
    expect(read.notRead).toEqual(["b.csv"]);
    const refused = read.ledger.diagnostics.filter(
      (d) => d.code === "sessionTooLarge",
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.severity).toBe("blocking");
  });

  it("reads a session within the budget whole", () => {
    const read = readExports({ files: [{ name: "a.csv", bytes: a }] });
    expect(read.notRead).toEqual([]);
    expect(
      read.ledger.diagnostics.some((d) => d.code === "sessionTooLarge"),
    ).toBe(false);
  });
});
