/**
 * Which of one year's returns a blocking finding from reading the files can
 * change (ADR 0017, amending ADR 0013 §9). Most such findings could bear on
 * anything, so they withhold both returns of every year. A refusal whose
 * adapter states the security, the date and what the row does to the
 * holding is scoped to the returns it can reach: a takeover paid in shares
 * booked in 2025 changes no figure of a 2026 return in which neither
 * security is sold, and must not withhold it.
 */
import { compareText } from "./compare.js";
import { isIsoDate, type IsoDate } from "./dates.js";
import {
  diagnostic,
  type Diagnostic,
  type RefusedShares,
} from "./diagnostics.js";
import { addDays } from "./holding.js";
import { isIsin } from "./isin.js";
import type { ValidatedLedger } from "./validate.js";
import { WASH_SALE_DAYS } from "./wash-sale.js";

/**
 * How long after an event a broker may book it. Trading 212 booked a
 * takeover and a special dividend several days after they happened, so a
 * row's date is its booking, not the event (research 06 §4.3). A month
 * keeps an event of late December booked in January on December's year.
 */
export const BOOKING_LAG_DAYS = 31;

/** One year's view of the ledger's findings. */
export interface LedgerScope {
  /** Blocking findings from reading the files that withhold Doh-KDVP. */
  readonly kdvp: readonly Diagnostic[];
  /** Blocking findings from reading the files that withhold Doh-Div. */
  readonly div: readonly Diagnostic[];
  /**
   * The ledger's findings as this year's review shows them, in order: a
   * refusal that can change neither return is a note that says so instead.
   */
  readonly findings: readonly Diagnostic[];
}

interface Scoped {
  readonly isin: string;
  readonly date: IsoDate;
  readonly shares: RefusedShares;
  readonly action?: string;
}

const SHARES: ReadonlySet<string> = new Set<RefusedShares>([
  "out",
  "in",
  "rights",
]);

/**
 * A refusal the rule can scope: one of the codes an adapter marks, with a
 * real ISIN, a real date and a known effect. Anything else is null, and
 * withholds everything, as before ADR 0017.
 */
function scopedOf(finding: Diagnostic): Scoped | null {
  if (finding.code !== "unsupportedAction" && finding.code !== "invalidPrice") {
    return null;
  }
  const { isin, date, shares } = finding.params;
  if (
    isin === undefined ||
    !isIsin(isin) ||
    date === undefined ||
    !isIsoDate(date) ||
    shares === undefined ||
    !SHARES.has(shares)
  ) {
    return null;
  }
  return finding.code === "unsupportedAction"
    ? { isin, date, shares, action: finding.params.action }
    : { isin, date, shares };
}

/** Before every date: a holding with no purchase on record reaches any year. */
const DAWN = "0000-01-01";

export function scopeLedger(
  ledger: ValidatedLedger,
  taxYear: number,
): LedgerScope {
  const yearStart = `${String(taxYear)}-01-01`;
  const yearEnd = `${String(taxYear)}-12-31`;
  const inYear = (date: IsoDate) =>
    compareText(date, yearStart) >= 0 && compareText(date, yearEnd) <= 0;
  const overlaps = (from: IsoDate, to: IsoDate) =>
    compareText(from, yearEnd) <= 0 && compareText(to, yearStart) >= 0;

  // Every file and account together: FIFO and the 30-day rule run across
  // all of a taxpayer's holdings (research 04 §4.4, §5.3).
  const sales: { readonly isin: string; readonly date: IsoDate }[] = [];
  const buys = new Map<string, IsoDate[]>();
  for (const event of ledger.events) {
    if (event.kind !== "trade") continue;
    const { isin } = event.security;
    if (event.side === "sell") {
      if (inYear(event.date)) sales.push({ isin, date: event.date });
    } else {
      const dates = buys.get(isin) ?? [];
      dates.push(event.date);
      buys.set(isin, dates);
    }
  }
  const firstBuy = (isin: string, until: IsoDate): IsoDate | null => {
    let first: IsoDate | null = null;
    for (const date of buys.get(isin) ?? []) {
      if (compareText(date, until) > 0) continue;
      if (first === null || compareText(date, first) < 0) first = date;
    }
    return first;
  };

  const kdvp: Diagnostic[] = [];
  const div: Diagnostic[] = [];
  const findings: Diagnostic[] = [];
  for (const finding of ledger.diagnostics) {
    const scoped = finding.severity === "blocking" ? scopedOf(finding) : null;
    if (scoped === null) {
      if (finding.severity === "blocking") {
        kdvp.push(finding);
        div.push(finding);
      }
      findings.push(finding);
      continue;
    }
    const { isin, date, shares } = scoped;
    // The event happened on the booking day or up to a month before it.
    const happened = addDays(date, -BOOKING_LAG_DAYS);
    // A sale of the same security from 30 days before the event on: FIFO
    // takes its lots with or without the refused row, and the 30-day rule
    // reads a purchase or a right 30 days either side of a loss sale
    // (ZDoh-2 art. 97(5), research 04 §5.3).
    const reach = addDays(happened, -WASH_SALE_DAYS);
    let onKdvp = sales.some(
      (sale) => sale.isin === isin && compareText(sale.date, reach) >= 0,
    );
    let onDiv = false;
    if (shares === "out") {
      // A disposal belongs to the year it happened, and that can be earlier
      // than its booking by more than a month: one reading dates a merger by
      // its agreement (research 04 §9.1). So every year from the first
      // purchase it gives up, or any year if none is on record.
      const from = firstBuy(isin, date) ?? DAWN;
      onKdvp ||= overlaps(
        compareText(from, happened) < 0 ? from : happened,
        date,
      );
    } else {
      // Shares or rights received might be income in their own year.
      onDiv = overlaps(happened, date);
      if (shares === "rights") {
        // A right to buy counts as acquiring capital of the same kind, for
        // a loss sale of any security it could be a right to (art.
        // 97(5)(1)); the row names only the right, so any sale reaches it.
        const until = addDays(date, WASH_SALE_DAYS);
        onKdvp ||= sales.some(
          (sale) =>
            compareText(sale.date, reach) >= 0 &&
            compareText(sale.date, until) <= 0,
        );
      }
    }
    if (onKdvp) kdvp.push(finding);
    if (onDiv) div.push(finding);
    findings.push(
      onKdvp || onDiv
        ? finding
        : diagnostic(
            "info",
            "refusedElsewhere",
            {
              isin,
              date,
              year: String(taxYear),
              ...(scoped.action === undefined ? {} : { action: scoped.action }),
            },
            finding.source,
          ),
    );
  }
  return { kdvp, div, findings };
}
