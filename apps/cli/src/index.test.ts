import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RateTable } from "@taxreporter/fx";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main, type Io } from "./index.js";
import { readExport, uniqueLabels } from "./intake.js";

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

/** Runs the CLI in-process, collecting what it prints. */
function run(args: string[]) {
  let stdout = "";
  let stderr = "";
  const io: Io = {
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  };
  const code = main(args, io, { loadRates: () => rates });
  return { code, stdout, stderr };
}

const scratch = () => mkdtempSync(join(tmpdir(), "taxreporter-"));

const payersFile = (dir: string) => {
  const file = join(dir, "payers.json");
  writeFileSync(
    file,
    JSON.stringify({
      US1912161007: {
        name: "The Coca-Cola Company",
        address: "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
        country: "US",
      },
    }),
  );
  return file;
};

const history = [
  fixture("t212-invest-v3-2025.csv"),
  fixture("t212-invest-v4-2026.csv"),
];

describe("taxreporter", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("explains itself when asked, and when used wrongly", () => {
    const help = run(["--help"]);
    expect([help.code, help.stdout]).toEqual([
      0,
      expect.stringContaining("Usage:"),
    ]);
    const none = run([]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("Usage:");
    const badNumber = run([
      ...history,
      "--year",
      "2026",
      "--tax-number",
      "123",
      "--out",
      "x",
    ]);
    expect([badNumber.code, badNumber.stderr]).toEqual([
      2,
      expect.stringContaining("--tax-number"),
    ]);
    const badYear = run([
      ...history,
      "--year",
      "26",
      "--tax-number",
      "12345678",
      "--out",
      "x",
    ]);
    expect(badYear.code).toBe(2);
    expect(run(["--unknown"]).code).toBe(2);
  });

  it("writes both returns from a Trading 212 history", () => {
    const dir = scratch();
    const out = join(dir, "out");
    const result = run([
      ...history,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      out,
      "--payers",
      payersFile(dir),
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Doh-KDVP 2026: 3 securities");
    expect(result.stdout).toContain("Doh-Div 2026: 1 payment,");
    // Both years' exports name the fund; the note is given once.
    expect(result.stdout.match(/fundFromName/g)).toHaveLength(1);
    expect(result.stdout).toContain("estimate");
    for (const file of ["Doh_KDVP_2026.xml", "Doh_Div_2026.xml"]) {
      expect(readFileSync(join(out, file), "utf8")).toMatch(/^<\?xml/);
    }
  });

  it("writes Doh-KDVP but holds Doh-Div back while a payer is unknown", () => {
    const out = join(scratch(), "out");
    const result = run([
      ...history,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      out,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("payerUnknown");
    expect(existsSync(join(out, "Doh_KDVP_2026.xml"))).toBe(true);
    expect(existsSync(join(out, "Doh_Div_2026.xml"))).toBe(false);
  });

  it("reports in JSON on request", () => {
    const dir = scratch();
    const result = run([
      ...history,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      join(dir, "out"),
      "--payers",
      payersFile(dir),
      "--json",
    ]);
    const report = JSON.parse(result.stdout) as {
      files: { format: string }[];
      written: string[];
      estimates: Record<string, string>;
      coverageEnd: string;
    };
    expect(report.files.map((f) => f.format)).toEqual([
      "trading212-csv-v3",
      "trading212-csv-v4",
    ]);
    expect(report.written).toHaveLength(2);
    expect(Object.keys(report.estimates)).toEqual([
      "gainsTaxEur",
      "dividendTaxDueEur",
    ]);
    expect(report.coverageEnd).toBe("2026-09-10");
  });

  it("refuses a file that is not a text export, and writes nothing", () => {
    const dir = scratch();
    const zip = join(dir, "export.csv");
    writeFileSync(zip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
    const out = join(dir, "out");
    const result = run([
      zip,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      out,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "Refused: export.csv is a ZIP or XLSX file",
    );
    expect(existsSync(out)).toBe(false);
  });

  it("wires the bin entry to main, the streams and the exit code", async () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const argv = process.argv;
    process.argv = ["node", "taxreporter", "--help"];
    try {
      await import("./bin.js");
    } finally {
      process.argv = argv;
    }
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(process.exitCode).toBe(0);
  });
});

describe("readExport", () => {
  const file = (bytes: number[] | string) => {
    const at = join(scratch(), "file.csv");
    writeFileSync(at, typeof bytes === "string" ? bytes : Buffer.from(bytes));
    return at;
  };

  it("reads UTF-8 text by its base name, without a byte-order mark", () => {
    const at = file([0xef, 0xbb, 0xbf, 0x41, 0x0a]);
    expect(readExport(at)).toEqual({ ok: true, name: "file.csv", text: "A\n" });
  });

  it("refuses what is not a UTF-8 text file", () => {
    const reason = (at: string) => {
      const intake = readExport(at);
      return intake.ok ? "read" : intake.reason;
    };
    expect(reason(file([0xff, 0xfe, 0x41, 0x00]))).toBe("utf16");
    expect(reason(file([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("pdf");
    expect(reason(file([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).toBe("spreadsheet");
    expect(reason(file([0x41, 0x00, 0x42]))).toBe("binary");
    expect(reason(file([0x41, 0xc3, 0x28]))).toBe("notUtf8");
    expect(reason(scratch())).toBe("notAFile");
    expect(reason(join(scratch(), "missing.csv"))).toBe("unreadable");
  });
});

describe("uniqueLabels", () => {
  it("tells apart files that share a base name", () => {
    expect(uniqueLabels(["a.csv", "a.csv", "b.csv", "a.csv (2)"])).toEqual([
      "a.csv",
      "a.csv (2)",
      "b.csv",
      "a.csv (2) (2)",
    ]);
  });
});
