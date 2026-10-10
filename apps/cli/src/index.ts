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
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { decodeUtf8, sniff } from "@taxreporter/brokers";
import {
  forExport,
  hasBlocking,
  isFileRef,
  isIsoDate,
  LIMITS,
  type Diagnostic,
  type FileId,
  type FileRefusal,
  type Severity,
} from "@taxreporter/core";
import {
  isTaxNumber,
  writeDohDiv,
  writeDohKdvp,
  type PayerInfo,
} from "@taxreporter/furs";
import { RateTable, type BsiRate } from "@taxreporter/fx";
import {
  prepareReturns,
  type AccountChoice,
  type Holdings,
} from "@taxreporter/pipeline";

import { readExport, uniqueLabels, type IntakeRefusal } from "./intake.js";

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
                   [--payers <payers.json>] [--coverage-end <YYYY-MM-DD>]
                   [--accounts same|separate] [--json]

Reads broker exports (Trading 212 history CSV, Trade Republic transaction
export CSV, Interactive Brokers Activity Flex Query XML) and writes the eDavki
returns
Doh_KDVP_<year>.xml and Doh_Div_<year>.xml into --out. Nothing leaves this
computer and nothing is filed: review the files, then import them in eDavki.

  --payers        a JSON object of payer details by ISIN, for Doh-Div:
                  {"US0378331005": {"name": "...", "address": "...", "country": "US"}}
  --coverage-end  the last day all your exports cover, for the 30-day rule;
                  worked out from the exports when left out
  --accounts      whether Trading 212 exports, which do not name their
                  account, come from one account (same, the default) or
                  each from its own (separate)
  --json          print a machine-readable report instead of text

Exit codes: 0 written with nothing blocking, 1 something blocks, 2 usage.
`;

/** What each refusal of a file means, for the person reading the terminal. */
const REFUSAL: Readonly<Record<IntakeRefusal | FileRefusal, string>> = {
  unreadable: "cannot be opened",
  notAFile: "is not a regular file",
  tooLarge: `is larger than any broker export (over ${String(LIMITS.fileBytes / 1024 / 1024)} MiB)`,
  changedWhileReading: "changed while it was being read",
  overSession: `was not read: the files together are larger than one run takes (over ${String(LIMITS.sessionBytes / 1024 / 1024)} MiB)`,
  zip: "is a ZIP archive, not a broker export",
  spreadsheet: "is an old Excel file; export CSV from your broker",
  pdf: "is a PDF; export CSV from your broker",
  gzip: "is compressed; export CSV from your broker",
  utf16: "is UTF-16 text; export it again from your broker, unchanged",
  utf32: "is UTF-32 text; export it again from your broker, unchanged",
  binary: "contains binary data",
  notUtf8: "is not UTF-8 text; export it again from your broker, unchanged",
  macroWorkbook:
    "is an Excel workbook with macros, which TaxReporter never opens; export it again from your broker",
  binaryWorkbook:
    "is a binary Excel workbook (XLSB); export it again from your broker as XLSX",
  strictWorkbook:
    "is a Strict Open XML workbook; export it again from your broker, unchanged",
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
  if (intake.bytes.length > MAX_PAYERS_LENGTH) {
    return "the payers file is too large";
  }
  const refusal = sniff(intake.bytes);
  if (refusal !== null) return `the payers file ${REFUSAL[refusal]}`;
  const text = decodeUtf8(intake.bytes);
  if (text === null) return `the payers file ${REFUSAL.notUtf8}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
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
 * A diagnostic as one line: code, parameters, and where it came from. Text
 * copied from a file is never printed: a terminal is often captured into a
 * log. The files a finding names, its source among them, are shown by the
 * labels of files the user named on the command line, which are theirs to
 * see.
 */
function describe(d: Diagnostic, labels: ReadonlyMap<FileId, string>): string {
  const exported = forExport(d).params;
  const params = Object.entries(d.params as Readonly<Record<string, unknown>>)
    .flatMap(([key, value]) => {
      if (isFileRef(value)) return [`${key}=${labels.get(value.file) ?? "?"}`];
      const shown = exported[key];
      return shown === undefined ? [] : [`${key}=${String(shown)}`];
    })
    .join(" ");
  const at =
    d.source === undefined
      ? ""
      : `  [${labels.get(d.source.fileId) ?? d.source.fileId}, row ${String(d.source.row)}]`;
  return `  ${d.code}${params === "" ? "" : `  ${params}`}${at}`;
}

/** The files a finding names besides its source, by their labels. */
function filesNamed(
  d: Diagnostic,
  labels: ReadonlyMap<FileId, string>,
): { files?: Record<string, string> } {
  const files = Object.entries(
    d.params as Readonly<Record<string, unknown>>,
  ).flatMap(([key, value]) =>
    isFileRef(value) ? [[key, labels.get(value.file) ?? "?"] as const] : [],
  );
  return files.length === 0 ? {} : { files: Object.fromEntries(files) };
}

/**
 * The shares still held, for other tools (ADR-0017): accounts by broker and
 * number, never by anything of the account itself; files by the names they
 * were given; every amount a plain decimal string. Quantities and prices to
 * the form's 8 decimals, since a reverse split can leave a fraction with no
 * finite expansion. Never part of the returns, and never a reason to block.
 */
function holdingsReport(
  holdings: Holdings,
  labels: ReadonlyMap<FileId, string>,
) {
  const rate = (r: BsiRate) => ({
    currency: r.listCurrency,
    rate: r.published,
    listDate: r.listDate,
    source: r.source,
  });
  return {
    accounts: holdings.accounts.map((a) => ({
      account: a.label.key,
      broker: a.label.broker,
      asOf: a.asOf,
      files: a.files.map((id) => labels.get(id) ?? id),
      transferred: a.transferred,
      refusedRows: a.refusedRows,
      positions: a.positions.map((p) => ({
        isin: p.isin,
        ...(p.security.symbol === undefined
          ? {}
          : { symbol: p.security.symbol }),
        quantity: p.quantity.toPlain(8, "halfUp"),
      })),
    })),
    securities: holdings.securities.map((s) => ({
      isin: s.isin,
      ...(s.security.symbol === undefined ? {} : { symbol: s.security.symbol }),
      ...(s.security.name === undefined ? {} : { name: s.security.name }),
      asOf: s.asOf,
      quantity: s.quantity.toPlain(8, "halfUp"),
      costEur: s.costEur?.toFixed(2, "halfUp") ?? null,
      incomplete: s.incomplete,
      lots: s.lots.map((l) => ({
        account: l.account.key,
        purchaseDate: l.purchaseDate,
        quantity: l.quantity.toPlain(8, "halfUp"),
        price: {
          amount: l.price.amount.toPlain(8, "halfUp"),
          currency: l.price.currency,
        },
        splitFactor: l.factor.toPlain(8, "halfUp"),
        rate: l.rate === null ? null : rate(l.rate),
        ...(l.missingRate === undefined ? {} : { missingRate: l.missingRate }),
        unitCostEur: l.unitCostEur?.toFixed(8, "halfUp") ?? null,
        costEur: l.costEur?.toFixed(2, "halfUp") ?? null,
        bucket: l.outlook.bucket,
        nextBucket: l.outlook.next,
        source: {
          file: labels.get(l.source.fileId) ?? l.source.fileId,
          row: l.source.row,
          ...(l.source.part === undefined ? {} : { part: l.source.part }),
        },
      })),
    })),
  };
}

const ACCOUNT_CHOICES: readonly string[] = ["same", "separate"];

/** What to do about a finding that `--accounts` answers. */
function accountHints(
  diagnostics: readonly Diagnostic[],
  accounts: AccountChoice,
): string[] {
  const has = (code: Diagnostic["code"]) =>
    diagnostics.some((d) => d.code === code);
  if (accounts === "same" && has("overlapMismatch")) {
    return [
      "  Two files of one account disagree about the days both cover. If they come from different accounts, run again with --accounts separate.",
    ];
  }
  if (accounts === "separate" && has("accountsShareEvents")) {
    return [
      "  Files taken for different accounts hold the same trades, which would count twice. If they come from one account, run again without --accounts separate.",
    ];
  }
  return [];
}

/**
 * Writes a return the way a reader of the folder can trust: to a new file
 * only the user may read (it holds their tax number and every trade), then
 * renamed over the old one, so a full disk or a crash never leaves half an
 * XML, and a link planted at the name is replaced, not followed.
 */
function writeReturn(path: string, xml: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, xml, { mode: 0o600, flag: "wx" });
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
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
        accounts: { type: "string", default: "same" },
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
  if (!ACCOUNT_CHOICES.includes(values.accounts)) {
    return usage("--accounts must be same or separate");
  }
  const accounts = values.accounts as AccountChoice;
  if (positionals.length === 0) return usage("give at least one export");
  if (positionals.length > LIMITS.filesPerSession) {
    return usage(
      `give at most ${String(LIMITS.filesPerSession)} exports at a time`,
    );
  }
  let payers = new Map<string, PayerInfo>();
  if (values.payers !== undefined) {
    const read = readPayers(values.payers);
    if (typeof read === "string") return usage(read);
    payers = read;
  }

  // The session's bytes are bounded before they are read, as the web app
  // bounds them (ADR 0013 §6): a file that would take them past
  // LIMITS.sessionBytes is not read, nor is any file after it, and the run
  // then writes nothing, as for any file refused.
  let room = LIMITS.sessionBytes;
  const intakes = positionals.map((file) => {
    const intake = readExport(file, room);
    if (intake.ok) room -= intake.bytes.length;
    else if (intake.reason === "overSession") room = -1;
    return intake;
  });
  const names = uniqueLabels(intakes.map((i) => i.name));
  const refused = intakes.flatMap((intake, i) =>
    intake.ok ? [] : [`${names[i] ?? intake.name} ${REFUSAL[intake.reason]}`],
  );
  const files = intakes.flatMap((intake, i) =>
    intake.ok ? [{ name: names[i] ?? intake.name, bytes: intake.bytes }] : [],
  );

  let prepared;
  try {
    prepared = prepareReturns({
      files,
      accounts,
      taxYear: year,
      taxpayer: { taxNumber },
      rates: dependencies.loadRates(),
      payers,
      ...(coverageEnd === undefined ? {} : { coverageEnd }),
    });
  } catch {
    // A fault of TaxReporter's, never of the files: they are refused with
    // findings. The error itself is not printed, as it could quote them.
    io.stderr.write(
      "taxreporter: stopped on an internal error; nothing was written. Please report it, without attaching your files.\n",
    );
    return 1;
  }
  const { kdvp, div } = prepared;
  const labels = new Map(prepared.imports.map((i) => [i.fileId, i.file]));
  // A file refused for what it is, said as such, like one that could not
  // be read at all.
  for (const { file, result } of prepared.imports) {
    for (const d of result.diagnostics) {
      if (d.code === "fileRefused") {
        refused.push(`${file} ${REFUSAL[d.params.reason]}`);
      }
    }
  }
  for (const clash of prepared.clashes) {
    refused.push(
      `${clash.file} has the file ID of ${clash.with} but other contents, so it was not read`,
    );
  }
  for (const file of prepared.notRead) {
    refused.push(
      `${file} was not read: the files hold more than one run takes`,
    );
  }
  // A finding without a source that both forms raise (one rate noted by
  // each) is one finding.
  const said = new Set<string>();
  const diagnostics = [
    ...prepared.ledger.diagnostics.filter(
      (d) => d.code !== "fileRefused" && d.code !== "fileIdClash",
    ),
    ...kdvp.diagnostics,
    ...div.diagnostics,
  ].filter((d) => {
    if (d.source !== undefined) return true;
    const key = JSON.stringify([d.severity, d.code, d.params]);
    if (said.has(key)) return false;
    said.add(key);
    return true;
  });

  // A form is written only when nothing about the files blocks it: a file
  // left out would leave its rows out of the return. One from an earlier
  // run that this run did not write is no longer the return, so say so.
  const written: string[] = [];
  const stale: string[] = [];
  let failed: string | null = null;
  const forms = [
    [`Doh_KDVP_${String(year)}.xml`, kdvp.form && writeDohKdvp(kdvp.form)],
    [`Doh_Div_${String(year)}.xml`, div.form && writeDohDiv(div.form)],
  ] as const;
  for (const [name, xml] of forms) {
    const path = join(out, name);
    if (xml === null || refused.length > 0) {
      if (existsSync(path)) stale.push(path);
      continue;
    }
    try {
      mkdirSync(out, { recursive: true });
      writeReturn(path, xml);
      written.push(path);
    } catch (error) {
      // The code only: an error's message repeats the path it failed on.
      const code = (error as { code?: unknown }).code;
      failed = `${name} could not be written into --out (${typeof code === "string" ? code : "error"})`;
      break;
    }
  }
  const blocked =
    refused.length > 0 || failed !== null || hasBlocking(diagnostics);
  const kdvpTax = kdvp.estimate.tax.toFixed(2, "halfUp");
  const divDue = div.estimate.taxDueEur.toFixed(2, "halfUp");

  if (values.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          files: prepared.imports.map((i) => ({
            file: i.file,
            fileId: i.fileId,
            format: i.result.format,
            events: i.result.events.length,
            lastDate:
              i.result.reach
                .map((r) => r.lastDate)
                .sort()
                .at(-1) ?? null,
          })),
          repeats: prepared.repeats,
          refused,
          coverageEnd: prepared.coverageEnd,
          written,
          stale,
          ...(failed === null ? {} : { failed }),
          estimates: { gainsTaxEur: kdvpTax, dividendTaxDueEur: divDue },
          holdings: holdingsReport(prepared.holdings, labels),
          diagnostics: diagnostics.map((d) => ({
            ...forExport(d),
            ...filesNamed(d, labels),
            ...(d.source === undefined
              ? {}
              : {
                  source: {
                    file: labels.get(d.source.fileId) ?? d.source.fileId,
                    row: d.source.row,
                    ...(d.source.part === undefined
                      ? {}
                      : { part: d.source.part }),
                  },
                }),
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
  for (const { file, sameAs } of prepared.repeats) {
    lines.push(`Skipped ${file}: the same file as ${sameAs}.`);
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
  if (failed !== null) lines.push(`Failed: ${failed}.`);
  for (const path of stale) {
    lines.push(
      `Not this run's: ${path} is from an earlier run and does not match these exports. Do not import it.`,
    );
  }
  for (const severity of ["blocking", "warning", "info"] as const) {
    const found = diagnostics.filter((d) => d.severity === severity);
    if (found.length === 0) continue;
    lines.push(
      "",
      `${SEVERITY_TITLE[severity]}:`,
      ...found.map((d) => describe(d, labels)),
      ...(severity === "blocking" ? accountHints(found, accounts) : []),
    );
  }
  lines.push(
    "",
    "The tax shown is an estimate; eDavki computes the real figure. Review the XML before importing it.",
  );
  io.stdout.write(`${lines.join("\n")}\n`);
  return blocked ? 1 : 0;
}
