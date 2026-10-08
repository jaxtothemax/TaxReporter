/**
 * @taxreporter/cli — the `taxreporter` command: broker exports in, FURS
 * eDavki XML out. The process entry is ./bin.ts; `main` takes its arguments
 * and streams, so the tests run it in-process.
 *
 * It prepares returns for the user to review and never files them, and the
 * tax it prints is an estimate (CLAUDE.md, "Tax correctness"). It reads only
 * the files it is given and writes only into --out: nothing leaves the
 * computer.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  forExport,
  hasBlocking,
  isIsoDate,
  type Diagnostic,
  type Severity,
} from "@taxreporter/core";
import {
  isTaxNumber,
  writeDohDiv,
  writeDohKdvp,
  type PayerInfo,
} from "@taxreporter/furs";
import { RateTable } from "@taxreporter/fx";

import { readExport, uniqueLabels, type IntakeRefusal } from "./intake.js";
import { prepareReturns } from "./prepare.js";

/** Where `main` writes: the process streams in the bin, buffers in tests. */
export interface Output {
  write(chunk: string): unknown;
}

export interface Io {
  readonly stdout: Output;
  readonly stderr: Output;
}

export interface Dependencies {
  /** The Banka Slovenije snapshot; the bin reads the one @taxreporter/fx ships. */
  readonly loadRates: () => RateTable;
}

const USAGE = `Usage: taxreporter <exports...> --year <YYYY> --tax-number <8 digits> --out <dir>
                   [--payers <payers.json>] [--coverage-end <YYYY-MM-DD>] [--json]

Reads broker exports (Trading 212 history CSV) and writes the eDavki returns
Doh_KDVP_<year>.xml and Doh_Div_<year>.xml into --out. Nothing leaves this
computer and nothing is filed: review the files, then import them in eDavki.

  --payers        a JSON object of payer details by ISIN, for Doh-Div:
                  {"US0378331005": {"name": "...", "address": "...", "country": "US"}}
  --coverage-end  the last day all your exports cover, for the 30-day rule;
                  worked out from the exports when left out
  --json          print a machine-readable report instead of text

Exit codes: 0 written with nothing blocking, 1 something blocks, 2 usage.
`;

/** What each intake refusal means, for the person reading the terminal. */
const REFUSAL: Readonly<Record<IntakeRefusal, string>> = {
  unreadable: "cannot be opened",
  notAFile: "is not a regular file",
  tooLarge: "is larger than any broker export (over 64 MiB)",
  changedWhileReading: "changed while it was being read",
  zip: "is a ZIP or XLSX file; export CSV from your broker",
  spreadsheet: "is an old Excel file; export CSV from your broker",
  pdf: "is a PDF; export CSV from your broker",
  utf16: "is UTF-16 text; export it again from your broker, unchanged",
  binary: "contains binary data",
  notUtf8: "is not UTF-8 text; export it again from your broker, unchanged",
};

const MAX_PAYERS_LENGTH = 1024 * 1024;

/** The snapshot @taxreporter/fx ships, read from its package. */
function shippedRates(): RateTable {
  const data = (file: string) =>
    readFileSync(
      fileURLToPath(import.meta.resolve(`@taxreporter/fx/data/${file}`)),
      "utf8",
    );
  const snapshot = JSON.parse(data("snapshot.json")) as {
    completeThrough: string;
  };
  return RateTable.fromCsv(
    data("bsi-daily.csv"),
    data("bsi-monthly.csv"),
    snapshot.completeThrough,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Payer details by ISIN from a JSON file. Only the fields Doh-Div uses are
 * kept, each a string; whether they are valid is the form's check.
 */
function readPayers(path: string): Map<string, PayerInfo> | string {
  const intake = readExport(path);
  if (!intake.ok) return `the payers file ${REFUSAL[intake.reason]}`;
  if (intake.text.length > MAX_PAYERS_LENGTH)
    return "the payers file is too large";
  let parsed: unknown;
  try {
    parsed = JSON.parse(intake.text);
  } catch {
    return "the payers file is not valid JSON";
  }
  if (!isRecord(parsed)) return "the payers file must hold a JSON object";
  const payers = new Map<string, PayerInfo>();
  for (const [isin, entry] of Object.entries(parsed)) {
    if (!isRecord(entry)) return "each payer must be a JSON object";
    const text = (key: string) => {
      const value = entry[key];
      return typeof value === "string" ? value : undefined;
    };
    const name = text("name");
    const address = text("address");
    const country = text("country");
    if (name === undefined || address === undefined || country === undefined) {
      return "each payer needs a name, an address and a country";
    }
    const optional = ["identificationNumber", "taxNumber", "sourceCountry"]
      .map((key) => [key, text(key)] as const)
      .filter(([, value]) => value !== undefined);
    payers.set(isin, {
      name,
      address,
      country,
      ...Object.fromEntries(optional),
    } as PayerInfo);
  }
  return payers;
}

const SEVERITY_TITLE: Readonly<Record<Severity, string>> = {
  blocking: "Must be fixed before the return can be written",
  warning: "Warnings",
  info: "Notes",
};

const count = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * A diagnostic as one line: code, parameters, and where it came from. Only
 * the export-safe parameters are printed, never text copied from a file:
 * a terminal is often captured into a log. The source is the label of a
 * file the user named on the command line.
 */
function describe(d: Diagnostic): string {
  const params = Object.entries(forExport(d).params)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  const at =
    d.source === undefined
      ? ""
      : `  [${d.source.file}, row ${String(d.source.row)}]`;
  return `  ${d.code}${params === "" ? "" : `  ${params}`}${at}`;
}

/** Runs the CLI and returns its exit code. */
export function main(
  argv: readonly string[],
  io: Io,
  dependencies: Dependencies = { loadRates: shippedRates },
): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        year: { type: "string" },
        "tax-number": { type: "string" },
        out: { type: "string" },
        payers: { type: "string" },
        "coverage-end": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch {
    io.stderr.write(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout.write(USAGE);
    return 0;
  }
  const usage = (problem: string) => {
    io.stderr.write(`taxreporter: ${problem}\n\n${USAGE}`);
    return 2;
  };
  const year = Number(values.year);
  if (!/^\d{4}$/.test(values.year ?? "") || year < 2013) {
    return usage("--year must be a tax year such as 2026");
  }
  const taxNumber = values["tax-number"] ?? "";
  if (!isTaxNumber(taxNumber)) {
    return usage("--tax-number must be your eight-digit davčna številka");
  }
  const out = values.out;
  if (out === undefined || out === "") return usage("--out is required");
  const coverageEnd = values["coverage-end"];
  if (coverageEnd !== undefined && !isIsoDate(coverageEnd)) {
    return usage("--coverage-end must be a date such as 2027-01-31");
  }
  if (positionals.length === 0) return usage("give at least one export");
  let payers = new Map<string, PayerInfo>();
  if (values.payers !== undefined) {
    const read = readPayers(values.payers);
    if (typeof read === "string") return usage(read);
    payers = read;
  }

  const intakes = positionals.map(readExport);
  const labels = uniqueLabels(intakes.map((i) => i.name));
  const refused = intakes.flatMap((intake, i) =>
    intake.ok ? [] : [`${labels[i] ?? intake.name} ${REFUSAL[intake.reason]}`],
  );
  const files = intakes.flatMap((intake, i) =>
    intake.ok ? [{ name: labels[i] ?? intake.name, text: intake.text }] : [],
  );

  const prepared = prepareReturns({
    files,
    taxYear: year,
    taxpayer: { taxNumber },
    rates: dependencies.loadRates(),
    payers,
    ...(coverageEnd === undefined ? {} : { coverageEnd }),
  });
  const { kdvp, div } = prepared;
  // A finding with no source that two files both raise (the same fund
  // named in two years' exports) is one finding.
  const said = new Set<string>();
  const diagnostics = [
    ...prepared.imports.flatMap((i) => i.result.diagnostics),
    ...kdvp.diagnostics,
    ...div.diagnostics,
  ].filter((d) => {
    if (d.source !== undefined) return true;
    const key = JSON.stringify([d.severity, d.code, d.params]);
    if (said.has(key)) return false;
    said.add(key);
    return true;
  });

  const written: string[] = [];
  if (refused.length === 0) {
    mkdirSync(out, { recursive: true });
    if (kdvp.form !== null) {
      const path = join(out, `Doh_KDVP_${String(year)}.xml`);
      writeFileSync(path, writeDohKdvp(kdvp.form));
      written.push(path);
    }
    if (div.form !== null) {
      const path = join(out, `Doh_Div_${String(year)}.xml`);
      writeFileSync(path, writeDohDiv(div.form));
      written.push(path);
    }
  }
  const blocked = refused.length > 0 || hasBlocking(diagnostics);
  const kdvpTax = kdvp.estimate.tax.toFixed(2, "halfUp");
  const divDue = div.estimate.taxDueEur.toFixed(2, "halfUp");

  if (values.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          files: prepared.imports.map((i) => ({
            file: i.file,
            format: i.result.format,
            events: i.result.events.length,
            lastDate: i.result.lastDate,
          })),
          refused,
          coverageEnd: prepared.coverageEnd,
          written,
          estimates: { gainsTaxEur: kdvpTax, dividendTaxDueEur: divDue },
          diagnostics: diagnostics.map((d) => ({
            ...forExport(d),
            ...(d.source === undefined ? {} : { source: d.source }),
          })),
        },
        null,
        2,
      )}\n`,
    );
    return blocked ? 1 : 0;
  }

  const lines: string[] = [];
  for (const line of refused) lines.push(`Refused: ${line}.`);
  for (const i of prepared.imports) {
    lines.push(
      `Read ${i.file} (${i.result.format}): ${String(i.result.events.length)} events.`,
    );
  }
  lines.push(
    kdvp.form === null
      ? `Doh-KDVP ${String(year)}: not written.`
      : `Doh-KDVP ${String(year)}: ${count(kdvp.form.lists.length, "security", "securities")}, estimated tax ${kdvpTax} EUR.`,
    div.form === null
      ? `Doh-Div ${String(year)}: not written.`
      : `Doh-Div ${String(year)}: ${count(div.form.dividends.length, "payment", "payments")}, estimated tax still due ${divDue} EUR.`,
  );
  for (const path of written) lines.push(`Wrote ${path}`);
  for (const severity of ["blocking", "warning", "info"] as const) {
    const found = diagnostics.filter((d) => d.severity === severity);
    if (found.length === 0) continue;
    lines.push("", `${SEVERITY_TITLE[severity]}:`, ...found.map(describe));
  }
  lines.push(
    "",
    "The tax shown is an estimate; eDavki computes the real figure. Review the XML before importing it.",
  );
  io.stdout.write(`${lines.join("\n")}\n`);
  return blocked ? 1 : 0;
}
