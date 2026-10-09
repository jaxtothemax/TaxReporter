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
import type { RateTable } from "@taxreporter/fx";

import {
  DEMO_COVERAGE_END,
  DEMO_PAYERS,
  DEMO_TAX_YEAR,
  DEMO_TAXPAYER,
  demoLedgerEvents,
} from "../demo/demoLedger";
import { loadRates } from "./rates";

/** One return as the download step offers it. */
export interface BuiltForm {
  /** The name it is saved under, the one the command line writes too. */
  readonly fileName: string;
  /** The XML eDavki imports, or null while a blocking finding stands. */
  readonly xml: string | null;
  /** How many blocking findings withhold it. */
  readonly blocking: number;
  /**
   * Whether the year has anything to file on it: rows, or a finding that
   * withholds it. A needed form is named on the download step even when it
   * has no rows to show (ADR 0013 §9).
   */
  readonly needed: boolean;
}

export interface BuiltReturns {
  readonly kdvp: BuiltForm;
  readonly div: BuiltForm;
}

const isBlocking = (d: Diagnostic) => d.severity === "blocking";

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
  const kdvpBlocking = fromLedger + kdvp.diagnostics.filter(isBlocking).length;
  const divBlocking = fromLedger + div.diagnostics.filter(isBlocking).length;
  return {
    kdvp: {
      fileName: `Doh_KDVP_${year}.xml`,
      xml: kdvp.form === null ? null : writeDohKdvp(kdvp.form),
      blocking: kdvpBlocking,
      needed: kdvp.lists.length > 0 || kdvpBlocking > 0,
    },
    div: {
      fileName: `Doh_Div_${year}.xml`,
      xml: div.form === null ? null : writeDohDiv(div.form),
      blocking: divBlocking,
      needed: div.dividends.length > 0 || divBlocking > 0,
    },
  };
}

/** What the download step awaits: the snapshot, then both returns. */
export async function buildDemoReturns(): Promise<BuiltReturns> {
  return demoReturns(await loadRates());
}
