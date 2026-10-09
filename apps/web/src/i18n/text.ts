/**
 * Text from a user's file as the screen shows it. React already renders it
 * as text, never markup; what is left is text that displays as something
 * it is not: control characters, bidirectional overrides and other format
 * characters (zero-width, soft hyphens, tags), line and paragraph
 * separators. The patterns are single character classes, linear on any
 * input.
 */

/** The characters a file's text may not bring to the screen. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** A name, a ticker or a value from a file: hidden characters become spaces. */
export function plainText(text: string): string {
  return text.replace(HIDDEN, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * A file's name: hidden characters become "?", so that they show, as the
 * command line shows them (apps/cli/src/intake.ts, `printable`).
 */
export function printableName(name: string): string {
  return name.replace(HIDDEN, "?");
}

/**
 * Whether a symbol looks like a ticker, to be shown beside its ISIN: short,
 * of the characters tickers use. Anything else, such as a "symbol" that
 * spells out an ISIN of its own, is not shown at all.
 */
export function isTicker(symbol: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}.:/_ -]{0,15}$/u.test(symbol);
}
