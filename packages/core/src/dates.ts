/**
 * Calendar dates as the ledger and both forms carry them: ISO 8601
 * "YYYY-MM-DD". One check for the whole project, so that a date one package
 * accepts no other refuses; and the one policy that turns a broker's clock
 * into the date a Slovenian return uses.
 */
import type { BrokerTime } from "./ledger.js";

/** An ISO 8601 calendar date, "2026-03-12". */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real calendar date written as YYYY-MM-DD, from the year 1000: the only
 * form xs:date takes in the FURS forms. Anything that is not a string is
 * refused, not coerced, since a model can come from JSON.
 */
export function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1000 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** A UTC instant to the second, as `BrokerTime.instant` holds it. */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const HOUR = 3_600_000;

/** The UTC instant of 01:00 on the last Sunday of `month` (0-based). */
function lastSundayAt1(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, sunday, 1);
}

const pad = (value: number, width: number) =>
  String(value).padStart(width, "0");

/**
 * The milliseconds of a UTC instant "YYYY-MM-DDTHH:MM:SSZ", or null when it
 * names no real time.
 */
export function instantMillis(instant: string): number | null {
  const match = INSTANT.exec(instant);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map(Number) as [number, number, number, number, number, number];
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const at = new Date(ms);
  const real =
    year >= 1970 &&
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59;
  return real ? ms : null;
}

/**
 * The calendar date in Ljubljana of a UTC instant. The offset follows the
 * EU summer-time rule Slovenia has applied since 1996: UTC+2 from 01:00 UTC
 * on the last Sunday of March to 01:00 UTC on the last Sunday of October,
 * UTC+1 otherwise. Computed rather than looked up, so the date does not
 * depend on the time-zone data a browser or Node happens to ship. Null when
 * the instant cannot be read, or its date is past year 9999.
 */
export function ljubljanaDate(instant: string): IsoDate | null {
  const ms = instantMillis(instant);
  if (ms === null) return null;
  const year = new Date(ms).getUTCFullYear();
  const summer = ms >= lastSundayAt1(year, 2) && ms < lastSundayAt1(year, 9);
  const local = new Date(ms + (summer ? 2 : 1) * HOUR);
  const date = `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1, 2)}-${pad(local.getUTCDate(), 2)}`;
  // The last hours of 9999 fall in year 10000 in Ljubljana: no date then.
  return isIsoDate(date) ? date : null;
}

/** An event's tax date, and whether the policy moved it off the broker's. */
export interface TaxDate {
  readonly date: IsoDate;
  /** The date differs from the one the broker shows: the user is told. */
  readonly moved: boolean;
}

/**
 * The date policy, the one place the rule lives (ADR 0011). For now: the
 * Ljubljana calendar date of the broker's instant where it gives one, else
 * the date it shows (IBKR's exchange date, used as is; research 06 §2).
 * Which clock decides a trade or payment date has no FURS source yet
 * (research 06, open questions); changing it is a change here and to the
 * golden files, nothing more. Null when the broker's clock is unusable.
 */
export function taxDate(at: BrokerTime): TaxDate | null {
  if (at.instant !== null) {
    const date = ljubljanaDate(at.instant);
    if (date === null) return null;
    if (at.brokerDate !== null && !isIsoDate(at.brokerDate)) return null;
    return {
      date,
      moved: at.brokerDate !== null && at.brokerDate !== date,
    };
  }
  return at.brokerDate !== null && isIsoDate(at.brokerDate)
    ? { date: at.brokerDate, moved: false }
    : null;
}
