/**
 * Turning a broker's UTC timestamp into the date a Slovenian return uses.
 *
 * The trade date of a sale and the payment date of a dividend are calendar
 * dates in Slovenia (CLAUDE.md, "Dates"). Trading 212 stamps rows in UTC, so
 * a trade at 23:30 UTC in summer happened on the next day in Ljubljana
 * (docs/research/06-brokers-ibkr-t212-revolut.md §2). The offset follows the
 * EU summer-time rule Slovenia has applied since 1996: UTC+2 from 01:00 UTC
 * on the last Sunday of March to 01:00 UTC on the last Sunday of October,
 * UTC+1 otherwise. Computed here rather than through Intl, so the date does
 * not depend on the time-zone data a browser or Node happens to ship.
 */
import type { IsoDate } from "@taxreporter/core";

/**
 * "2026-03-01 01:10:00", with optional fractional seconds and an optional
 * "Z" or "+00:00": the forms Trading 212 has written (06 §4.2). Anchored and
 * without nested repetition, so it runs in linear time on any input.
 */
const UTC_STAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)?$/;

const HOUR = 3_600_000;

/** The UTC instant of 01:00 on the last Sunday of `month` (0-based). */
function lastSundayAt1(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, sunday, 1);
}

const pad = (value: number, width: number) =>
  String(value).padStart(width, "0");

export interface UtcStamp {
  /** The date in Ljubljana. */
  readonly date: IsoDate;
  /** The instant to the second, for telling rows apart ("2026-03-01T01:10:00Z"). */
  readonly second: string;
}

/**
 * Reads a UTC timestamp and gives its Ljubljana date, or null when the text
 * is not one of the accepted forms or names no real time.
 */
export function fromUtcStamp(text: string): UtcStamp | null {
  const match = UTC_STAMP.exec(text);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  const instant = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(instant);
  if (
    year < 1970 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const summer =
    instant >= lastSundayAt1(year, 2) && instant < lastSundayAt1(year, 9);
  const local = new Date(instant + (summer ? 2 : 1) * HOUR);
  return {
    date: `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1, 2)}-${pad(local.getUTCDate(), 2)}`,
    second: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}Z`,
  };
}
