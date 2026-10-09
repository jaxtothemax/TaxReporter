/**
 * Exact decimal arithmetic for money, quantities and rates (ADR 0006).
 *
 * A Decimal is an exact rational number: a BigInt numerator over a positive
 * BigInt denominator, kept in lowest terms. Converting a foreign amount at a
 * Banka Slovenije rate divides by that rate, and the quotient rarely has a
 * finite decimal expansion (214.87 / 1.1547 = 186.08296527...). A
 * fixed-precision decimal would have to round it on the spot; a rational keeps
 * it exact through every later sum and product, and the value is rounded once,
 * when a form field is written, at that field's scale and with that field's
 * documented rounding mode.
 *
 * There is deliberately no way to build a Decimal from a binary float: amounts
 * come from source strings, and counts from safe integers.
 */

/**
 * How a value is rounded to a field's scale.
 *
 * - `halfUp`: to the nearest, ties away from zero (2.345 → 2.35, -2.345 →
 *   -2.35). The mode the research recommends for every FURS amount
 *   (docs/research/01-furs-doh-kdvp.md §7).
 * - `down`: toward zero, i.e. truncation.
 */
export type RoundingMode = "halfUp" | "down";

/** A plain decimal string: optional minus, digits, optional fraction. */
const PLAIN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Longest source string accepted. Imported files are hostile: a megabyte of
 * digits would make every later operation slow, and no real amount, quantity
 * or rate comes near this.
 */
export const MAX_DECIMAL_LENGTH = 64;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * Only this module builds a Decimal directly. The constructor trusts its
 * arguments (lowest terms, positive denominator), and `private` binds only
 * TypeScript, so plain JavaScript gets a token check instead.
 */
const TRUSTED: unique symbol = Symbol("Decimal");

export class Decimal {
  static readonly ZERO = new Decimal(0n, 1n, TRUSTED);
  static readonly ONE = new Decimal(1n, 1n, TRUSTED);

  readonly #num: bigint;
  /** Always positive; the sign lives in the numerator. */
  readonly #den: bigint;

  private constructor(num: bigint, den: bigint, token: typeof TRUSTED) {
    if (token !== TRUSTED) {
      throw new TypeError("Build a Decimal with Decimal.parse");
    }
    this.#num = num;
    this.#den = den;
  }

  /**
   * Whether a value is a Decimal this module built: a check on the private
   * fields themselves, which an object that merely borrows the prototype
   * lacks, so it fails here rather than on its first method call.
   */
  static isDecimal(value: unknown): value is Decimal {
    return typeof value === "object" && value !== null && #num in value;
  }

  /** Builds num/den in lowest terms with a positive denominator. */
  static #ratio(num: bigint, den: bigint): Decimal {
    if (den === 0n) throw new RangeError("Division by zero");
    if (num === 0n) return Decimal.ZERO;
    const divisor = gcd(num, den);
    const sign = den < 0n ? -1n : 1n;
    return new Decimal((sign * num) / divisor, (sign * den) / divisor, TRUSTED);
  }

  /**
   * Parses a plain decimal string such as "1234.5678" or "-0.5". Anything
   * else (exponents, thousands separators, a decimal comma, whitespace) is
   * refused: an adapter normalizes its broker's notation first, so that a
   * misread number fails loudly instead of becoming a wrong amount.
   */
  static parse(text: string): Decimal {
    // Typed, but a model can come from JSON: a number is not a source
    // string, and a float must never be coerced into one (ADR 0006).
    const input: unknown = text;
    if (typeof input !== "string") {
      throw new RangeError("Not a plain decimal string");
    }
    if (text.length > MAX_DECIMAL_LENGTH) {
      throw new RangeError(
        `Decimal string longer than ${String(MAX_DECIMAL_LENGTH)} characters`,
      );
    }
    const match = PLAIN.exec(text);
    if (match === null) {
      // The input is not echoed: when a file's columns are misread, the text
      // handed here can be a name or an account number (CLAUDE.md, Privacy).
      throw new RangeError("Not a plain decimal string");
    }
    const [, sign = "", whole = "0", fraction = ""] = match;
    const magnitude = BigInt(whole + fraction);
    return Decimal.#ratio(
      sign === "-" ? -magnitude : magnitude,
      10n ** BigInt(fraction.length),
    );
  }

  /**
   * A whole number, e.g. a count of shares from a split ratio. The error
   * does not repeat the value, which can come from an imported file.
   */
  static fromInteger(value: number | bigint): Decimal {
    const input: unknown = value;
    if (typeof input === "bigint") return Decimal.#ratio(input, 1n);
    if (typeof input !== "number" || !Number.isSafeInteger(input)) {
      throw new RangeError("Not a safe integer");
    }
    return Decimal.#ratio(BigInt(input), 1n);
  }

  static sum(values: Iterable<Decimal>): Decimal {
    let total = Decimal.ZERO;
    for (const value of values) total = total.plus(value);
    return total;
  }

  plus(other: Decimal): Decimal {
    return Decimal.#ratio(
      this.#num * other.#den + other.#num * this.#den,
      this.#den * other.#den,
    );
  }

  minus(other: Decimal): Decimal {
    return this.plus(other.negated());
  }

  times(other: Decimal): Decimal {
    return Decimal.#ratio(this.#num * other.#num, this.#den * other.#den);
  }

  /** Exact division; throws on a zero divisor. */
  dividedBy(other: Decimal): Decimal {
    return Decimal.#ratio(this.#num * other.#den, this.#den * other.#num);
  }

  negated(): Decimal {
    return this.#num === 0n
      ? this
      : new Decimal(-this.#num, this.#den, TRUSTED);
  }

  abs(): Decimal {
    return this.#num < 0n ? this.negated() : this;
  }

  /** -1, 0 or 1. */
  compare(other: Decimal): -1 | 0 | 1 {
    const diff = this.#num * other.#den - other.#num * this.#den;
    return diff === 0n ? 0 : diff < 0n ? -1 : 1;
  }

  equals(other: Decimal): boolean {
    return this.#num === other.#num && this.#den === other.#den;
  }

  lessThan(other: Decimal): boolean {
    return this.compare(other) < 0;
  }

  greaterThan(other: Decimal): boolean {
    return this.compare(other) > 0;
  }

  isZero(): boolean {
    return this.#num === 0n;
  }

  isNegative(): boolean {
    return this.#num < 0n;
  }

  isPositive(): boolean {
    return this.#num > 0n;
  }

  /** True when the value has at most `scale` decimals, so rounding to it changes nothing. */
  isExactAt(scale: number): boolean {
    return 10n ** BigInt(checkScale(scale)) % this.#den === 0n;
  }

  /** The value rounded to `scale` decimals, as a Decimal. */
  round(scale: number, mode: RoundingMode): Decimal {
    return Decimal.#ratio(this.#scaled(scale, mode), 10n ** BigInt(scale));
  }

  /**
   * Rounded to `scale` decimals and written with exactly that many, e.g.
   * "22.20". The form for amounts that are always shown at a fixed scale.
   */
  toFixed(scale: number, mode: RoundingMode): string {
    const units = this.#scaled(scale, mode);
    const negative = units < 0n;
    const digits = (negative ? -units : units)
      .toString()
      .padStart(scale + 1, "0");
    const whole = digits.slice(0, digits.length - scale);
    const fraction = digits.slice(digits.length - scale);
    return `${negative ? "-" : ""}${whole}${scale > 0 ? `.${fraction}` : ""}`;
  }

  /**
   * Rounded to `scale` decimals, then written without trailing zeros: "10",
   * "158.48329049". The form for quantities and per-unit values, where a
   * fixed tail of zeros adds nothing.
   */
  toPlain(scale: number, mode: RoundingMode): string {
    const fixed = this.toFixed(scale, mode);
    if (!fixed.includes(".")) return fixed;
    // By index, not by a regular expression: /\.?0+$/ backtracks on long
    // runs of zeros.
    let end = fixed.length;
    while (fixed.charCodeAt(end - 1) === 0x30) end -= 1;
    if (fixed.charCodeAt(end - 1) === 0x2e) end -= 1;
    return fixed.slice(0, end);
  }

  /**
   * The exact value as a plain decimal string, when it has a finite
   * expansion; throws for a value such as 1/3, which has to be rounded to a
   * scale first.
   */
  toString(): string {
    let den = this.#den;
    let scale = 0;
    for (const factor of [2n, 5n]) {
      while (den % factor === 0n) den /= factor;
    }
    if (den !== 1n) {
      throw new RangeError(
        "No finite decimal expansion; round it to a scale first",
      );
    }
    while (10n ** BigInt(scale) % this.#den !== 0n) scale += 1;
    return this.toPlain(scale, "down");
  }

  /** The value times 10^scale, rounded to an integer. */
  #scaled(scale: number, mode: RoundingMode): bigint {
    const unit = 10n ** BigInt(checkScale(scale));
    const negative = this.#num < 0n;
    const magnitude = (negative ? -this.#num : this.#num) * unit;
    let units = magnitude / this.#den;
    const remainder = magnitude % this.#den;
    if (mode === "halfUp" && remainder * 2n >= this.#den) units += 1n;
    return negative ? -units : units;
  }
}

// ZERO and ONE are shared by every caller: frozen, like the class and its
// methods, so no code can replace or shadow them.
Object.freeze(Decimal);
Object.freeze(Decimal.prototype);
Object.freeze(Decimal.ZERO);
Object.freeze(Decimal.ONE);

function checkScale(scale: number): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > 100) {
    throw new RangeError(`Not a decimal scale: ${String(scale)}`);
  }
  return scale;
}
