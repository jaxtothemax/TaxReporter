/**
 * The demo's returns, built the way every return is: the demo's ledger
 * through `validateLedger`, the Doh-KDVP and Doh-Div builders and the XML
 * writers, at Banka Slovenije rates (ADR 0011). The download step loads this
 * module, and the rate snapshot with it, only when it opens, so the first
 * screens stay light.
 */
import { validateLedger, type Diagnostic } from "@taxreporter/core";
import {
  buildDohDiv,
  buildDohKdvp,
  writeDohDiv,
  writeDohKdvp,
} from "@taxreporter/furs";
import { RateTable } from "@taxreporter/fx";

import {
  DEMO_COVERAGE_END,
  DEMO_PAYERS,
  DEMO_TAX_YEAR,
  DEMO_TAXPAYER,
  demoLedgerEvents,
} from "../demo/demoLedger";

/** One return as the download step offers it. */
export interface BuiltForm {
  /** The name it is saved under, the one the command line writes too. */
  readonly fileName: string;
  /** The XML eDavki imports, or null while a blocking finding stands. */
  readonly xml: string | null;
  /** How many blocking findings withhold it. */
  readonly blocking: number;
}

export interface BuiltReturns {
  readonly kdvp: BuiltForm;
  readonly div: BuiltForm;
}

const isBlocking = (d: Diagnostic) => d.severity === "blocking";

/** The rate snapshot @taxreporter/fx ships, bundled as text, never fetched. */
async function loadRates(): Promise<RateTable> {
  const [daily, monthly, snapshot] = await Promise.all([
    import("@taxreporter/fx/data/bsi-daily.csv?raw"),
    import("@taxreporter/fx/data/bsi-monthly.csv?raw"),
    import("@taxreporter/fx/data/snapshot.json?raw"),
  ]);
  const { completeThrough } = JSON.parse(snapshot.default) as {
    readonly completeThrough: string;
  };
  return RateTable.fromCsv(daily.default, monthly.default, completeThrough);
}

/** Both returns over the demo's ledger, at the given rates. */
export function demoReturns(rates: RateTable): BuiltReturns {
  const ledger = validateLedger(demoLedgerEvents());
  const fromLedger = ledger.diagnostics.filter(isBlocking).length;
  const year = String(DEMO_TAX_YEAR);
  const kdvp = buildDohKdvp({
    taxYear: DEMO_TAX_YEAR,
    taxpayer: DEMO_TAXPAYER,
    ledger,
    rates,
    coverageEnd: DEMO_COVERAGE_END,
  });
  const div = buildDohDiv({
    taxYear: DEMO_TAX_YEAR,
    taxpayer: DEMO_TAXPAYER,
    ledger,
    rates,
    payers: DEMO_PAYERS,
  });
  return {
    kdvp: {
      fileName: `Doh_KDVP_${year}.xml`,
      xml: kdvp.form === null ? null : writeDohKdvp(kdvp.form),
      blocking: fromLedger + kdvp.diagnostics.filter(isBlocking).length,
    },
    div: {
      fileName: `Doh_Div_${year}.xml`,
      xml: div.form === null ? null : writeDohDiv(div.form),
      blocking: fromLedger + div.diagnostics.filter(isBlocking).length,
    },
  };
}

/** What the download step awaits: the snapshot, then both returns. */
export async function buildDemoReturns(): Promise<BuiltReturns> {
  return demoReturns(await loadRates());
}
