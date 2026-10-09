/**
 * From exports to returns: every file through `importFile`, every event
 * through `validateLedger`, then both builders over the one ledger. The CLI
 * and the web app run exactly these steps, so the same files give the same
 * XML in both (ADR 0013 §1). Free of I/O, Node.js and the DOM.
 *
 * `readExports` is the first half alone, for a screen that comes before the
 * taxpayer's details are known: nothing that needs a tax number runs without
 * one, so no placeholder taxpayer ever exists.
 */
import { importFile, type ImportResult } from "@taxreporter/brokers";
import {
  compareText,
  diagnostic,
  fileIdOf,
  fileRef,
  isIsoDate,
  LIMITS,
  validateLedger,
  type Diagnostic,
  type FileId,
  type IsoDate,
  type ValidatedLedger,
} from "@taxreporter/core";
import {
  buildDohDiv,
  buildDohKdvp,
  type DivBuild,
  type KdvpBuild,
  type PayerInfo,
  type Taxpayer,
} from "@taxreporter/furs";
import type { RateTable } from "@taxreporter/fx";

export interface ExportFile {
  /** A label for the screen: see `uniqueLabels`. Never part of the result. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Whether files from a broker that does not name the account in them, such
 * as Trading 212, are one account (the default, ADR 0011 §4) or one each.
 */
export type AccountChoice = "same" | "separate";

export interface ReadInput {
  readonly files: readonly ExportFile[];
  readonly accounts?: AccountChoice;
}

export interface BuildInput {
  readonly taxYear: number;
  readonly taxpayer: Taxpayer;
  readonly rates: RateTable;
  /** Payer details by ISIN, for Doh-Div. */
  readonly payers: ReadonlyMap<string, PayerInfo>;
  /** The last day all the exports cover; worked out from them when absent. */
  readonly coverageEnd?: IsoDate;
}

export type PrepareInput = ReadInput & BuildInput;

/** The files read and their events checked: everything but the returns. */
export interface ReadExports {
  /** Each distinct file, in the order given. */
  readonly imports: readonly {
    readonly file: string;
    readonly fileId: FileId;
    readonly result: ImportResult;
  }[];
  /** Files with the same bytes as one before them, read once. */
  readonly repeats: readonly {
    readonly file: string;
    readonly sameAs: string;
  }[];
  /**
   * Files whose ID is that of a file before them while their bytes differ:
   * not read, and the forms are withheld. By chance this does not happen;
   * it takes two files made to collide.
   */
  readonly clashes: readonly {
    readonly file: string;
    readonly with: string;
  }[];
  /**
   * Files left unread once the session held more events, or more bytes,
   * than it may: the session is then refused (`sessionTooLarge` for bytes).
   */
  readonly notRead: readonly string[];
  /** Every event, checked, and every finding from reading the files. */
  readonly ledger: ValidatedLedger;
}

export interface Prepared extends ReadExports {
  /** The coverage end the 30-day rule used. */
  readonly coverageEnd: IsoDate;
  readonly kdvp: KdvpBuild;
  readonly div: DivBuild;
}

/**
 * How far the exports reach, for the 30-day rule: per account, the latest
 * date of any of its rows; across accounts, the earliest of those, since
 * one account's files ending early could hide a replacement there. It errs
 * short: an account quiet in its last weeks makes more losses wait, never
 * fewer.
 */
export function coverageOf(
  imports: readonly ImportResult[],
  taxYear: number,
): IsoDate {
  const latest = new Map<string, IsoDate>();
  for (const { account, lastDate } of imports.flatMap((i) => i.reach)) {
    // An adapter's date is checked here too: coverage decides 30-day rules.
    if (!isIsoDate(lastDate)) continue;
    const seen = latest.get(account);
    if (seen === undefined || compareText(lastDate, seen) > 0) {
      latest.set(account, lastDate);
    }
  }
  const ends = [...latest.values()].sort(compareText);
  return ends[0] ?? `${String(taxYear)}-01-01`;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Reads every file and checks the session's events together. */
export function readExports(input: ReadInput): ReadExports {
  // Byte-identical files are one file (ADR 0011 §1). A file ID is 64 bits
  // of a hash, so a repeated ID is checked against the bytes themselves.
  const seen = new Map<FileId, ExportFile>();
  const distinct: { file: string; fileId: FileId; bytes: Uint8Array }[] = [];
  const repeats: { file: string; sameAs: string }[] = [];
  const clashes: { file: string; with: string }[] = [];
  const carried: Diagnostic[] = [];
  for (const file of input.files) {
    const fileId = fileIdOf(file.bytes);
    const first = seen.get(fileId);
    if (first === undefined) {
      seen.set(fileId, file);
      distinct.push({ file: file.name, fileId, bytes: file.bytes });
    } else if (sameBytes(first.bytes, file.bytes)) {
      repeats.push({ file: file.name, sameAs: first.name });
    } else {
      clashes.push({ file: file.name, with: first.name });
      carried.push(
        diagnostic("blocking", "fileIdClash", { file: fileRef(fileId) }),
      );
    }
  }
  // Separate accounts are numbered by file ID, never by the order the files
  // were given in: the return must not depend on it.
  const groups = new Map(
    [...seen.keys()].sort(compareText).map((id, i) => [id, i + 1]),
  );
  // Once the session holds more events, or more bytes, than it may, the
  // rest of the files are left unread, and the session is refused: a
  // return without a file's rows would be wrong, not short. The events
  // are refused by the ledger, the bytes here.
  const imports: ReadExports["imports"][number][] = [];
  const notRead: string[] = [];
  let events = 0;
  let size = 0;
  let overBudget = false;
  for (const { file, fileId, bytes } of distinct) {
    if (overBudget || size + bytes.length > LIMITS.sessionBytes) {
      overBudget = true;
      notRead.push(file);
      continue;
    }
    if (events > LIMITS.eventsPerSession) {
      notRead.push(file);
      continue;
    }
    size += bytes.length;
    const result = importFile({
      bytes,
      fileId,
      accountGroup:
        input.accounts === "separate" ? (groups.get(fileId) ?? 1) : 1,
    });
    events += result.events.length;
    imports.push({ file, fileId, result });
  }
  if (overBudget) {
    carried.push(
      diagnostic("blocking", "sessionTooLarge", {
        mebibytes: LIMITS.sessionBytes / 1024 / 1024,
      }),
    );
  }
  const ledger = validateLedger(
    imports.flatMap((i) => i.result.events),
    [...carried, ...imports.flatMap((i) => i.result.diagnostics)],
  );
  return { imports, repeats, clashes, notRead, ledger };
}

/** Both returns over what `readExports` read. */
export function buildReturns(read: ReadExports, input: BuildInput): Prepared {
  const { ledger } = read;
  // No export reaches past the rates it can be converted at: a row dated
  // later, a deposit in 2099, must not close every 30-day window.
  const reached = coverageOf(
    read.imports.map((i) => i.result),
    input.taxYear,
  );
  const coverageEnd =
    input.coverageEnd ??
    (compareText(reached, input.rates.completeThrough) > 0
      ? input.rates.completeThrough
      : reached);
  const kdvp = buildDohKdvp({
    taxYear: input.taxYear,
    taxpayer: input.taxpayer,
    ledger,
    rates: input.rates,
    coverageEnd,
  });
  const div = buildDohDiv({
    taxYear: input.taxYear,
    taxpayer: input.taxpayer,
    ledger,
    rates: input.rates,
    payers: input.payers,
  });
  return { ...read, coverageEnd, kdvp, div };
}

/** Reads the files and builds both returns: `readExports`, then `buildReturns`. */
export function prepareReturns(input: PrepareInput): Prepared {
  return buildReturns(readExports(input), input);
}
