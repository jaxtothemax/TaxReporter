/**
 * The session's byte budget in the command line, with LIMITS.sessionBytes
 * made small: a file past it is measured and never read, no file after it
 * is even opened, and nothing is written (ADR 0013 §6).
 */
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RateTable } from "@taxreporter/fx";
import { describe, expect, it, vi } from "vitest";

import { main, type Io } from "./index.js";

// Hoisted above the fixtures: a budget between the first file (1,144
// bytes) and both together (2,951), checked below.
const BUDGET = vi.hoisted(() => 2000);
/** Every byte the command line reads from a file, through readSync. */
const read = vi.hoisted(() => ({ bytes: 0 }));

vi.mock("@taxreporter/core", async (original) => {
  const core = await original<typeof import("@taxreporter/core")>();
  return {
    ...core,
    LIMITS: Object.freeze({ ...core.LIMITS, sessionBytes: BUDGET }),
  };
});

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const readSync = fs.readSync as (...args: unknown[]) => number;
  return {
    ...fs,
    readSync: (...args: unknown[]) => {
      const bytes = readSync(...args);
      read.bytes += bytes;
      return bytes;
    },
  };
});

const root = new URL("../../../", import.meta.url);
const path = (relative: string) => fileURLToPath(new URL(relative, root));
const data = (file: string) =>
  readFileSync(path(`packages/fx/data/${file}`), "utf8");
const rates = RateTable.fromCsv(
  data("bsi-daily.csv"),
  data("bsi-monthly.csv"),
  (JSON.parse(data("snapshot.json")) as { completeThrough: string })
    .completeThrough,
);
const fixture = (file: string) =>
  path(`packages/brokers/test/fixtures/trading212/${file}`);
const first = fixture("t212-invest-v3-2025.csv");
const second = fixture("t212-invest-v4-2026.csv");

function run(args: string[]) {
  let stdout = "";
  const io: Io = {
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: () => undefined },
  };
  return { code: main(args, io, { loadRates: () => rates }), stdout };
}

describe("taxreporter: the session's bytes", () => {
  it("reads no file past the budget, nor any after it, and writes nothing", () => {
    // Room for the first file and not for both.
    expect(statSync(first).size).toBeLessThan(BUDGET);
    expect(statSync(first).size + statSync(second).size).toBeGreaterThan(
      BUDGET,
    );
    const out = join(mkdtempSync(join(tmpdir(), "taxreporter-")), "out");
    // Opened, a file that is not there would be "cannot be opened".
    const absent = join(out, "absent.csv");
    read.bytes = 0;
    const { code, stdout } = run([
      first,
      second,
      absent,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      out,
    ]);
    expect(code).toBe(1);
    expect(read.bytes).toBe(statSync(first).size);
    expect(stdout).toContain(
      "t212-invest-v4-2026.csv was not read: the files together are larger than one run takes",
    );
    expect(stdout).toContain("absent.csv was not read");
    expect(stdout).not.toContain("cannot be opened");
    expect(existsSync(join(out, "Doh_KDVP_2026.xml"))).toBe(false);
    expect(existsSync(join(out, "Doh_Div_2026.xml"))).toBe(false);
  });

  it("reads a file within the budget whole", () => {
    const out = join(mkdtempSync(join(tmpdir(), "taxreporter-")), "out");
    read.bytes = 0;
    const { stdout } = run([
      first,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      out,
    ]);
    expect(read.bytes).toBe(statSync(first).size);
    expect(stdout).not.toContain("was not read");
  });
});
