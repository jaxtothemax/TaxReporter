import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { crc32 } from "node:zlib";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { accountScope, LIMITS } from "@taxreporter/core";
import { writeDohDiv, writeDohKdvp } from "@taxreporter/furs";
import { RateTable } from "@taxreporter/fx";
import { prepareReturns } from "@taxreporter/pipeline";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main, type Io } from "./index.js";
import { printable, readExport, uniqueLabels } from "./intake.js";

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

/** A ZIP archive of one stored file: the smallest a ZIP can be. */
function storedZip(name: string, content: Buffer): Buffer {
  const fileName = Buffer.from(name);
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const entry = Buffer.concat([local, fileName, content]);
  const directory = Buffer.concat([central, fileName]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(entry.length, 16);
  return Buffer.concat([entry, directory, end]);
}

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

const V4_HEADER =
  "Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax)";

/** A Trading 212 V4 export of Coca-Cola purchases: [time, order ID]. */
function purchases(dir: string, name: string, rows: [string, string][]) {
  const path = join(dir, name);
  const lines = rows.map(
    ([time, id]) =>
      `Market buy,${time}+00:00,US1912161007,KO,Coca-Cola,,${id},1,70,USD,,,,1,EUR,,`,
  );
  writeFileSync(path, [V4_HEADER, ...lines].join("\n"));
  return path;
}

const args2026 = (out: string, ...extra: string[]) => [
  "--year",
  "2026",
  "--tax-number",
  "12345678",
  "--out",
  out,
  ...extra,
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

  it("writes exactly the shared pipeline's XML, as the web app does for the same files", () => {
    const dir = scratch();
    const out = join(dir, "out");
    const exports = [
      ...history,
      path("packages/brokers/test/fixtures/ibkr/flex-activity-2025-2026.xml"),
    ];
    const result = run([
      ...exports,
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
    // What the web app's engine hands the pipeline for the same files, a
    // tax number alone and Coca-Cola's payer: its test proves the engine
    // writes this XML too (apps/web/src/engine/handle.test.ts, ADR 0013 §1).
    const expected = prepareReturns({
      files: exports.map((file) => ({
        name: basename(file),
        bytes: readFileSync(file),
      })),
      taxYear: 2026,
      taxpayer: { taxNumber: "12345678" },
      rates,
      payers: new Map([
        [
          "US1912161007",
          {
            name: "The Coca-Cola Company",
            address: "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
            country: "US",
          },
        ],
      ]),
    });
    if (expected.kdvp.form === null || expected.div.form === null) {
      throw new Error("the pipeline wrote no form");
    }
    expect(readFileSync(join(out, "Doh_KDVP_2026.xml"), "utf8")).toBe(
      writeDohKdvp(expected.kdvp.form),
    );
    expect(readFileSync(join(out, "Doh_Div_2026.xml"), "utf8")).toBe(
      writeDohDiv(expected.div.form),
    );
  });

  it("writes Doh-KDVP from a Trade Republic export", () => {
    const out = join(scratch(), "out");
    const result = run([
      path(
        "packages/brokers/test/fixtures/trade-republic/tr-transactions-2026.csv",
      ),
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      out,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("traderepublic-csv-2026");
    const xml = readFileSync(join(out, "Doh_KDVP_2026.xml"), "utf8");
    // Bought 2 Apple on 10 March, sold 1 on 15 July (Ljubljana time).
    expect(xml).toContain("<ISIN>US0378331005</ISIN>");
    expect(xml).toContain("2026-07-15");
    expect(xml).toContain("2026-03-10");
    // No dividends: Doh-Div has nothing to file.
    expect(existsSync(join(out, "Doh_Div_2026.xml"))).toBe(false);
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
      holdings: {
        accounts: { account: string; files: string[] }[];
        securities: { lots: { account: string; costEur: string | null }[] }[];
      };
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
    expect(Object.keys(report.holdings)).toEqual(["accounts", "securities"]);
    expect(report.holdings.accounts.map((a) => a.account)).toEqual([
      "trading212-1",
    ]);
    expect(report.holdings.accounts[0]?.files).toEqual([
      "t212-invest-v3-2025.csv",
      "t212-invest-v4-2026.csv",
    ]);
    // Every lot is named by its account's label and costed in EUR.
    const lots = report.holdings.securities.flatMap((s) => s.lots);
    expect(lots.length).toBeGreaterThan(0);
    for (const lot of lots) {
      expect(lot.account).toBe("trading212-1");
      expect(lot.costEur).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("names accounts in its JSON by broker and number, never by the account", () => {
    const dir = scratch();
    const ibkr = path(
      "packages/brokers/test/fixtures/ibkr/flex-activity-2025-2026.xml",
    );
    const result = run([
      ibkr,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      join(dir, "out"),
      "--json",
    ]);
    const report = JSON.parse(result.stdout) as {
      holdings: { accounts: { account: string }[] };
    };
    expect(report.holdings.accounts.map((a) => a.account)).toEqual([
      "ibkr-1",
      "ibkr-2",
    ]);
    for (const id of ["U16000001", "U16000002"]) {
      expect(result.stdout).not.toContain(id);
      expect(result.stdout).not.toContain(accountScope("ibkr", id));
      // Nor the hash alone, which an account number's few values give away.
      expect(result.stdout).not.toContain(
        accountScope("ibkr", id).slice("ibkr:".length),
      );
    }
  });

  it("reads a file given twice once, and says so", () => {
    const dir = scratch();
    const result = run([
      ...history,
      history[1] ?? "",
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      join(dir, "out"),
      "--payers",
      payersFile(dir),
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "Skipped t212-invest-v4-2026.csv (2): the same file as t212-invest-v4-2026.csv.",
    );
    expect(result.stdout).not.toContain("duplicate");
  });

  it("takes as many exports as a session may hold, and refuses one more", () => {
    const dir = scratch();
    const args = (copies: number) => [
      ...Array.from({ length: copies }, () => history[1] ?? ""),
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      join(dir, String(copies)),
      "--json",
    ];
    const full = run(args(LIMITS.filesPerSession));
    expect(full.code).not.toBe(2);
    expect(
      (JSON.parse(full.stdout) as { repeats: unknown[] }).repeats,
    ).toHaveLength(LIMITS.filesPerSession - 1);
    const over = run(args(LIMITS.filesPerSession + 1));
    expect([over.code, over.stderr]).toEqual([
      2,
      expect.stringContaining(
        `at most ${String(LIMITS.filesPerSession)} exports`,
      ),
    ]);
  });

  it("takes Trading 212 exports as one account, or each as its own", () => {
    const dir = scratch();
    const args = (accounts: string, out: string) => [
      ...history,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      join(dir, out),
      "--payers",
      payersFile(dir),
      "--accounts",
      accounts,
    ];
    expect(run(args("separate", "a")).code).toBe(0);
    expect(run(args("same", "b")).code).toBe(0);
    // Two years of one account: the lots are the same either way.
    const xml = (out: string) =>
      readFileSync(join(dir, out, "Doh_KDVP_2026.xml"), "utf8");
    expect(xml("a")).toBe(xml("b"));
    expect(run(args("both", "c")).code).toBe(2);
  });

  it("writes nothing while a row of an export is refused", () => {
    const dir = scratch();
    const export2026 = join(dir, "export.csv");
    const giftCard =
      "Gift card,2026-02-01 10:00:00+00:00,,,,,,,,,,,,5.00,EUR,,,,,,";
    writeFileSync(
      export2026,
      `${readFileSync(fixture("t212-invest-v4-2026.csv"), "utf8")}${giftCard}\n`,
    );
    const out = join(dir, "out");
    const result = run([
      fixture("t212-invest-v3-2025.csv"),
      export2026,
      "--year",
      "2026",
      "--tax-number",
      "12345678",
      "--out",
      out,
      "--payers",
      payersFile(dir),
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("unknownAction");
    expect(result.stdout).toContain("[export.csv, row 12]");
    expect(result.stdout).not.toContain("Gift card");
    expect(existsSync(out)).toBe(false);
  });

  it("names both files of an overlap that disagrees, and says what --accounts does", () => {
    const dir = scratch();
    const a = purchases(dir, "a.csv", [
      ["2026-01-06 10:00:00", "EOF1"],
      ["2026-02-10 10:00:00", "EOF2"],
      ["2026-03-02 10:00:00", "EOF3"],
    ]);
    // Another account's export over February, taken for the same account.
    const b = purchases(dir, "b.csv", [
      ["2026-02-03 10:00:00", "EOF9"],
      ["2026-02-20 10:00:00", "EOF8"],
    ]);
    const same = run([a, b, ...args2026(join(dir, "same"))]);
    expect(same.code).toBe(1);
    expect(same.stdout).toMatch(
      /overlapMismatch {2}kind=trade from=2026-02-03 to=2026-02-20 first=(a|b)\.csv second=(a|b)\.csv/,
    );
    expect(same.stdout).toContain("run again with --accounts separate");
    const separate = run([
      a,
      b,
      ...args2026(join(dir, "separate"), "--accounts", "separate"),
    ]);
    expect(separate.stdout).not.toContain("overlapMismatch");
    expect(separate.code).toBe(0);
  });

  it("blocks one account's overlapping exports taken for two accounts", () => {
    const dir = scratch();
    const again = join(dir, "again.csv");
    // The same rows, ending in a blank line: another file of one account.
    writeFileSync(again, `${readFileSync(history[1] ?? "", "utf8")}\n`);
    const out = join(dir, "out");
    const result = run([
      history[0] ?? "",
      history[1] ?? "",
      again,
      ...args2026(out, "--payers", payersFile(dir), "--accounts", "separate"),
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("accountsShareEvents  kind=trade");
    expect(result.stdout).toContain("run again without --accounts separate");
    expect(existsSync(out)).toBe(false);
  });

  it("writes the same XML whatever order the files come in", () => {
    const dir = scratch();
    const xml = (out: string) =>
      ["Doh_KDVP_2026.xml", "Doh_Div_2026.xml"].map((name) =>
        readFileSync(join(dir, out, name), "utf8"),
      );
    for (const accounts of ["same", "separate"]) {
      const orders = [history, [...history].reverse()];
      for (const [i, files] of orders.entries()) {
        const code = run([
          ...files,
          ...args2026(
            join(dir, `${accounts}${String(i)}`),
            "--payers",
            payersFile(dir),
            "--accounts",
            accounts,
          ),
        ]).code;
        expect(code).toBe(0);
      }
      expect(xml(`${accounts}1`)).toEqual(xml(`${accounts}0`));
    }
  });

  it("writes a return only its owner may read, and flags one a later run did not write", () => {
    const dir = scratch();
    const out = join(dir, "out");
    expect(
      run([...history, ...args2026(out, "--payers", payersFile(dir))]).code,
    ).toBe(0);
    const kdvp = join(out, "Doh_KDVP_2026.xml");
    if (process.platform !== "win32") {
      expect(statSync(kdvp).mode & 0o777).toBe(0o600);
    }
    // Now an export with a row the adapter refuses: no return this time,
    // and the one already there is not this run's.
    const refused = join(dir, "export.csv");
    writeFileSync(
      refused,
      `${readFileSync(history[1] ?? "", "utf8")}Gift card,2026-02-01 10:00:00+00:00,,,,,,,,,,,,5.00,EUR,,,,,,\n`,
    );
    const later = run([
      history[0] ?? "",
      refused,
      ...args2026(out, "--payers", payersFile(dir)),
    ]);
    expect(later.code).toBe(1);
    expect(later.stdout).toContain(
      `Not this run's: ${kdvp} is from an earlier run`,
    );
    expect(existsSync(kdvp)).toBe(true);
  });

  it("never prints an order number, a note or a refused row's text", () => {
    const dir = scratch();
    const canary = join(dir, "export.csv");
    writeFileSync(
      canary,
      [
        V4_HEADER,
        "Market buy,2026-01-06 10:00:00+00:00,US1912161007,KO,Coca-Cola,CANARYNOTE,CANARYORDER1,2,69.5,USD,,,,1,EUR,,",
        "Market sell,2026-02-06 10:00:00+00:00,US1912161007,KO,Coca-Cola,,CANARYORDER2,x,70,USD,,,,1,EUR,,",
        "CANARYACTION,2026-02-07 10:00:00+00:00,,,,CANARYNOTE,CANARYORDER3,,,,,,,1,EUR,,",
      ].join("\n"),
    );
    for (const json of [[], ["--json"]]) {
      const result = run([canary, ...args2026(join(dir, "out"), ...json)]);
      expect(result.code).toBe(1);
      expect(`${result.stdout}${result.stderr}`).not.toContain("CANARY");
    }
  });

  it("refuses a ZIP that is no workbook, and writes nothing", () => {
    const dir = scratch();
    const zip = join(dir, "export.csv");
    writeFileSync(zip, storedZip("notes.txt", Buffer.from("hello")));
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
      "Refused: export.csv is a ZIP archive, not a broker export",
    );
    expect(existsSync(out)).toBe(false);
  });

  it("reads a damaged ZIP as the workbook it claims to be, names why not, and writes nothing", () => {
    const dir = scratch();
    const zip = join(dir, "export.xlsx");
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
    expect(result.stdout).toContain("unreadableFile");
    expect(result.stdout).toContain("zipEnd");
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
  const file = (bytes: number[]) => {
    const at = join(scratch(), "file.csv");
    writeFileSync(at, Buffer.from(bytes));
    return at;
  };

  it("reads a file's bytes by its base name, leaving what they are to importFile", () => {
    const at = file([0xef, 0xbb, 0xbf, 0x41, 0x0a]);
    expect(readExport(at)).toEqual({
      ok: true,
      name: "file.csv",
      bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x0a]),
    });
  });

  it("refuses what is no regular file it can read", () => {
    const reason = (at: string) => {
      const intake = readExport(at);
      return intake.ok ? "read" : intake.reason;
    };
    expect(reason(scratch())).toBe("notAFile");
    expect(reason(join(scratch(), "missing.csv"))).toBe("unreadable");
  });

  it.skipIf(process.platform === "win32")(
    "refuses a FIFO at once, rather than wait for a writer",
    () => {
      const fifo = join(scratch(), "export.csv");
      execFileSync("mkfifo", [fifo]);
      expect(readExport(fifo)).toEqual({
        ok: false,
        name: "export.csv",
        reason: "notAFile",
      });
    },
  );

  it("reads a file under a name the terminal can show", () => {
    const at = join(scratch(), "izvoz\u001b[2J.csv");
    writeFileSync(at, "A\n");
    expect(readExport(at)).toMatchObject({ ok: true, name: "izvoz?[2J.csv" });
  });

  it("names a file without the control characters its name may hold", () => {
    expect(printable("a\u001b[2Jb\u202ecsv.exe\u0085")).toBe("a?[2Jb?csv.exe?");
    expect(printable("Izvoz 2026 (č).csv")).toBe("Izvoz 2026 (č).csv");
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
