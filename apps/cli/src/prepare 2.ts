/**
 * From exports to returns: every file through its adapter, then both
 * builders over everything imported. The CLI and, later, the web app run the
 * same steps, so the same files give the same XML (spec v0.1, "Command-line
 * interface"); this module is the part they share, kept free of I/O.
 */
import { importFile, type ImportResult } from "@taxreporter/brokers";
import { compareText, type IsoDate } from "@taxreporter/core";
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
  /** A label unique among the files: see `uniqueLabels`. */
  readonly name: string;
  readonly text: string;
}

export interface PrepareInput {
  readonly files: readonly ExportFile[];
  readonly taxYear: number;
  readonly taxpayer: Taxpayer;
  readonly rates: RateTable;
  /** Payer details by ISIN, for Doh-Div. */
  readonly payers: ReadonlyMap<string, PayerInfo>;
  /** The last day all the exports cover; worked out from them when absent. */
  readonly coverageEnd?: IsoDate;
}

export interface Prepared {
  readonly imports: readonly {
    readonly file: string;
    readonly result: ImportResult;
  }[];
  /** The coverage end the 30-day rule used. */
  readonly coverageEnd: IsoDate;
  readonly kdvp: KdvpBuild;
  readonly div: DivBuild;
}

/**
 * How far the exports reach, for the 30-day rule: per broker, the latest
 * date of any of its rows; across brokers, the earliest of those, since one
 * broker's files ending early could hide a replacement there. It errs short:
 * a broker quiet in its last weeks makes more losses wait, never fewer.
 */
export function coverageOf(
  imports: readonly ImportResult[],
  taxYear: number,
): IsoDate {
  const latest = new Map<string, IsoDate>();
  for (const result of imports) {
    if (result.lastDate === null) continue;
    const seen = latest.get(result.broker);
    if (seen === undefined || compareText(result.lastDate, seen) > 0) {
      latest.set(result.broker, result.lastDate);
    }
  }
  const ends = [...latest.values()].sort(compareText);
  return ends[0] ?? `${String(taxYear)}-01-01`;
}

export function prepareReturns(input: PrepareInput): Prepared {
  const imports = input.files.map((file) => ({
    file: file.name,
    result: importFile(file.name, file.text),
  }));
  const events = imports.flatMap((i) => i.result.events);
  const coverageEnd =
    input.coverageEnd ??
    coverageOf(
      imports.map((i) => i.result),
      input.taxYear,
    );
  const kdvp = buildDohKdvp({
    taxYear: input.taxYear,
    taxpayer: input.taxpayer,
    events,
    rates: input.rates,
    coverageEnd,
  });
  const div = buildDohDiv({
    taxYear: input.taxYear,
    taxpayer: input.taxpayer,
    events,
    rates: input.rates,
    payers: input.payers,
  });
  return { imports, coverageEnd, kdvp, div };
}
