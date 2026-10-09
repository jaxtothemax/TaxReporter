/**
 * What a number cell of an XLSX workbook holds, read the one way research
 * 09 settles (ADR 0014 §8–9). A cell stores a binary double as text, so
 * these read that text exactly, as decimal digits, and never through a
 * JavaScript number:
 *
 * - a number is rounded once to 15 significant digits, ties away from
 *   zero, which gives back the decimal of at most 15 digits the producing
 *   program held, whichever spelling the writer chose;
 * - a date serial is read exactly, never rounded first: its whole days in
 *   the workbook's date system, its fraction the time of day, snapped to
 *   the millisecond and truncated to the second;
 * - an identifier is an integer of at most 15 digits, as a double holds it.
 *
 * Each returns null for text it does not take, and the caller says why.
 * The grammar is anchored and without nested repetition, and the length is
 * checked first, so any text costs time linear in its length.
 */
import { LIMITS, MAX_DECIMAL_LENGTH, type IsoDate } from "@taxreporter/core";

/** Longer than any spelling of a double, even its exact value to 40 digits. */
const MAX_TEXT = 64;

/** Sign, whole digits, fraction, exponent: `-1.5`, `.5`, `5.`, `1E-3`. */
const NUMBER = /^([-+]?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d{1,5}))?$/;

/** Significant digits a double keeps (research 09 §1, `DBL_DIG`). */
const DIGITS = 15;

/** A number's text, as its digits and the place of its decimal point. */
interface Spelled {
  readonly negative: boolean;
  /** Digits without leading zeros; "" for zero. */
  readonly digits: string;
  /** The value is 0.`digits` × 10^`point`. */
  readonly point: number;
}

function spell(text: string): Spelled | null {
  if (text.length > MAX_TEXT) return null;
  const match = NUMBER.exec(text);
  if (match === null) return null;
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const all = whole + fraction;
  if (all.length === 0) return null;
  let first = 0;
  while (first < all.length && all.charCodeAt(first) === 0x30) first += 1;
  // Zero, and "-0", before any digit is counted.
  if (first === all.length) return { negative: false, digits: "", point: 0 };
  return {
    negative: sign === "-",
    digits: all.slice(first),
    point: whole.length + Number(exponent) - first,
  };
}

/** Digits with the point placed: "12.5", "0.0125", "1250". */
function plain(negative: boolean, digits: string, point: number): string {
  let body: string;
  if (point <= 0) body = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) {
    body = digits + "0".repeat(point - digits.length);
  } else body = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return negative ? `-${body}` : body;
}

/**
 * A number cell's value as a plain decimal ("0.3", "-1250", "0"): its text
 * rounded to 15 significant digits, ties away from zero, trailing zeros
 * dropped. Null when the text is no number, or its value lies past
 * 10^±LIMITS.xlsxExponent.
 */
export function cellNumber(text: string): string | null {
  const spelled = spell(text);
  if (spelled === null) return null;
  let { digits, point } = spelled;
  if (digits === "") return "0";
  if (digits.length > DIGITS) {
    // Half or more of the 15th digit's unit rounds the magnitude up: away
    // from zero, as Decimal's halfUp does.
    const up = digits.charCodeAt(DIGITS) >= 0x35;
    digits = digits.slice(0, DIGITS);
    if (up) {
      const raised = (BigInt(digits) + 1n).toString();
      // 999…9 + 1 gains a digit: the point moves one place.
      if (raised.length > DIGITS) {
        digits = raised.slice(0, DIGITS);
        point += 1;
      } else digits = raised;
    }
  }
  let end = digits.length;
  while (end > 1 && digits.charCodeAt(end - 1) === 0x30) end -= 1;
  digits = digits.slice(0, end);
  // The value is d.ddd × 10^(point - 1).
  const exponent = point - 1;
  if (Math.abs(exponent) > LIMITS.xlsxExponent) return null;
  const value = plain(spelled.negative, digits, point);
  return value.length <= MAX_DECIMAL_LENGTH ? value : null;
}

/**
 * An identifier a broker writes as a number (a position or order ID): a
 * whole number of at most 15 digits, exactly as stored, without sign. A
 * longer one has lost digits in the double, and two would share a key.
 */
export function cellInteger(text: string): string | null {
  const spelled = spell(text);
  if (spelled === null || spelled.negative) return null;
  const { point } = spelled;
  let { digits } = spelled;
  if (digits === "") return "0";
  let end = digits.length;
  while (digits.charCodeAt(end - 1) === 0x30) end -= 1;
  digits = digits.slice(0, end);
  if (point > DIGITS || point < digits.length) return null;
  return digits + "0".repeat(point - digits.length);
}

/** The 1900 system's day 0, which serials from 61 count from. */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
/** The 1904 system's day 0. */
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const DAY_MS = 86_400_000;

/** A serial as whole days, and the time of day to the millisecond. */
interface Serial {
  readonly days: number;
  /** Milliseconds into the day, 0 to 86,399,999. */
  readonly ms: number;
}

/**
 * A day of the workbook's date system as a date, or null before 1 March
 * 1900 in the 1900 system or past 31 December 9999. Serial 60 is
 * 29 February 1900, which never was; earlier serials count from a day
 * before, and no broker export reaches back that far.
 */
function dateOf(days: number, date1904: boolean): IsoDate | null {
  if (!date1904 && days < 61) return null;
  const date = new Date((date1904 ? EPOCH_1904 : EPOCH_1900) + days * DAY_MS);
  const year = date.getUTCFullYear();
  if (year > 9999) return null;
  return [
    String(year).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * A serial's days and time (research 09 §2), exactly: its whole days, its
 * fraction snapped to the nearest millisecond, half up, which can carry
 * into the next day.
 */
function serial(text: string): Serial | null {
  const spelled = spell(text);
  if (spelled === null || spelled.negative) return null;
  const { digits, point } = spelled;
  // The serial as a fraction: whole / 10^scale, exact.
  const scale = Math.max(digits.length - point, 0);
  if (point > 7 || scale > MAX_TEXT) return null;
  const value =
    digits === ""
      ? 0n
      : BigInt(digits + "0".repeat(Math.max(point - digits.length, 0)));
  const unit = 10n ** BigInt(scale);
  let days = Number(value / unit);
  const fraction = value % unit;
  let ms = Number((fraction * BigInt(DAY_MS) * 2n + unit) / (2n * unit));
  if (ms === DAY_MS) {
    days += 1;
    ms = 0;
  }
  return { days, ms };
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * A serial's day and its time of day to the second, truncated, as brokers'
 * text exports print it: truncating never moves an event into the next
 * day. Null for a negative serial, one in the 1900 system before 1 March
 * 1900, or one past 31 December 9999.
 */
export function serialDateTime(
  text: string,
  date1904: boolean,
): { readonly date: IsoDate; readonly time: string } | null {
  const read = serial(text);
  const date = read === null ? null : dateOf(read.days, date1904);
  if (read === null || date === null) return null;
  const seconds = Math.floor(read.ms / 1000);
  const time = [
    two(Math.floor(seconds / 3600)),
    two(Math.floor(seconds / 60) % 60),
    two(seconds % 60),
  ].join(":");
  return { date, time };
}

/**
 * A serial in a column of dates without times: the day, or null when the
 * serial is more than a millisecond off a whole day, which is no date the
 * broker meant.
 */
export function serialDate(text: string, date1904: boolean): IsoDate | null {
  const read = serial(text);
  if (read === null) return null;
  if (read.ms <= 1) return dateOf(read.days, date1904);
  // Within a millisecond of the next day: that day.
  if (read.ms >= DAY_MS - 1) return dateOf(read.days + 1, date1904);
  return null;
}
