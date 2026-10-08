/**
 * A broker's UTC timestamp, read into the clock the ledger keeps (ADR 0011
 * §7). Only the reading is here: which calendar date a return uses is the
 * date policy's, `taxDate` in @taxreporter/core, so it lives in one place.
 */
import { instantMillis, type BrokerTime } from "@taxreporter/core";

/**
 * "2026-03-01 01:10:00", with optional fractional seconds and an optional
 * "Z" or "+00:00": the forms Trading 212 has written (research 06 §4.2).
 * Anchored and without nested repetition, so it runs in linear time on any
 * input.
 */
const UTC_STAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)?$/;

/**
 * A UTC timestamp as the broker's clock: the instant cut to the second, and
 * the UTC date the file shows. Null when the text is not one of the
 * accepted forms or names no real time.
 */
export function fromUtcStamp(text: string): BrokerTime | null {
  const match = UTC_STAMP.exec(text);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const instant = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  return instantMillis(instant) === null
    ? null
    : { instant, brokerDate: `${year}-${month}-${day}` };
}
