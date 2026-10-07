/**
 * Locale-aware display formatting for decimal strings and ISO dates.
 *
 * Amounts arrive as decimal strings and are handed to Intl.NumberFormat AS
 * STRINGS: since ES2023 it formats a numeric string exactly instead of
 * converting it to a binary float first, so a value is never rounded twice and
 * never picks up float noise on its way to the screen (ADR 0006). Rounding for
 * display is half-up ("halfExpand"), the same mode the form fields use.
 */

export const LOCALES = ["sl", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** BCP 47 tags: Slovenian, and British English for day-month-year dates. */
const TAG: Readonly<Record<Locale, string>> = { sl: "sl-SI", en: "en-GB" };

/** A plain decimal string: optional minus, digits, optional fraction. */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function numeric(value: string): Intl.StringNumericLiteral {
  if (!PLAIN_DECIMAL.test(value)) {
    throw new RangeError(`Not a plain decimal string: "${value}"`);
  }
  return value as Intl.StringNumericLiteral;
}

/** True when the decimal string is negative (and not a negative zero). */
export function isNegative(value: string): boolean {
  return numeric(value).startsWith("-") && /[1-9]/.test(value);
}

export interface NumberOptions {
  /** Fraction digits always shown (default 0). */
  readonly minFraction?: number;
  /** Fraction digits at most (default: minFraction). */
  readonly maxFraction?: number;
  /** Show "+" on positive values, e.g. for gains. */
  readonly signed?: boolean;
}

export function formatNumber(
  value: string,
  locale: Locale,
  options: NumberOptions = {},
): string {
  const minimumFractionDigits = options.minFraction ?? 0;
  return new Intl.NumberFormat(TAG[locale], {
    minimumFractionDigits,
    maximumFractionDigits: options.maxFraction ?? minimumFractionDigits,
    roundingMode: "halfExpand",
    signDisplay: options.signed === true ? "exceptZero" : "auto",
  }).format(numeric(value));
}

function eurFormat(
  locale: Locale,
  options: { readonly signed?: boolean },
): Intl.NumberFormat {
  return new Intl.NumberFormat(TAG[locale], {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    roundingMode: "halfExpand",
    signDisplay: options.signed === true ? "exceptZero" : "auto",
  });
}

/** A euro amount at cent precision, e.g. "1.770,04 €" or "€1,770.04". */
export function formatEur(
  value: string,
  locale: Locale,
  options: { readonly signed?: boolean } = {},
): string {
  return eurFormat(locale, options).format(numeric(value));
}

/** One run of a formatted euro amount, tagged so it can be styled apart. */
export interface AmountPart {
  /** "main": sign and whole units; "cents": separator and cents; "currency": symbol and its spacing. */
  readonly role: "main" | "cents" | "currency";
  readonly text: string;
}

/**
 * formatEur in runs, so a headline figure can set its cents and currency
 * smaller than the whole units. The runs keep the locale's own order, and
 * joined they are exactly formatEur's output.
 */
export function formatEurParts(
  value: string,
  locale: Locale,
  options: { readonly signed?: boolean } = {},
): AmountPart[] {
  const runs: AmountPart[] = [];
  for (const part of eurFormat(locale, options).formatToParts(numeric(value))) {
    const role =
      part.type === "decimal" || part.type === "fraction"
        ? "cents"
        : part.type === "currency" || part.type === "literal"
          ? "currency"
          : "main";
    const last = runs.at(-1);
    if (last?.role === role) {
      runs[runs.length - 1] = { role, text: last.text + part.value };
    } else {
      runs.push({ role, text: part.value });
    }
  }
  return runs;
}

/** An amount in its own currency, as the broker reported it. */
export function formatMoney(
  amount: string,
  currency: string,
  locale: Locale,
): string {
  const fraction = amount.split(".")[1]?.length ?? 0;
  return new Intl.NumberFormat(TAG[locale], {
    style: "currency",
    currency,
    // ISO codes, not symbols: "$" alone cannot tell USD from CAD or AUD, and the
    // rate text next to it ("1 EUR = 1,1547 USD") uses the code too.
    currencyDisplay: "code",
    // Keep every digit the broker gave (per-unit prices can carry 4 or more),
    // but never fewer than the currency's usual 2.
    minimumFractionDigits: Math.max(2, fraction),
    maximumFractionDigits: Math.max(2, fraction),
    roundingMode: "halfExpand",
  }).format(numeric(amount));
}

/**
 * A Banka Slovenije rate with exactly the digits BSI published: "1.1900"
 * stays "1,1900", because the list keeps its trailing zeros and the user should
 * be able to find the same figure on it.
 */
export function formatRate(rate: string, locale: Locale): string {
  const fraction = rate.split(".")[1]?.length ?? 0;
  return formatNumber(rate, locale, {
    minFraction: fraction,
    maxFraction: fraction,
  });
}

/** A fraction such as "0.15" as a percentage, e.g. "15 %" or "15%". */
export function formatPercent(fraction: string, locale: Locale): string {
  return new Intl.NumberFormat(TAG[locale], {
    style: "percent",
    maximumFractionDigits: 3,
    roundingMode: "halfExpand",
  }).format(numeric(fraction));
}

/**
 * An ISO calendar date: "12. 3. 2026" in Slovenian, "12 Mar 2026" in English.
 * Built in UTC so the calendar day never shifts with the viewer's time zone.
 */
export function formatDate(iso: string, locale: Locale): string {
  const match = ISO_DATE.exec(iso);
  if (match === null) {
    throw new RangeError(`Not an ISO date: "${iso}"`);
  }
  const [, year, month, day] = match.map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(TAG[locale], {
    day: "numeric",
    month: locale === "sl" ? "numeric" : "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

const ISO_MONTH = /^(\d{4})-(\d{2})$/;

/**
 * A calendar month such as "2026-03": "m" or "marec" in Slovenian, "M" or
 * "March" in English. The narrow form labels a chart axis.
 */
export function formatMonth(
  month: string,
  locale: Locale,
  width: "narrow" | "long",
): string {
  const match = ISO_MONTH.exec(month);
  if (match === null) {
    throw new RangeError(`Not an ISO month: "${month}"`);
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat(TAG[locale], {
    month: width,
    timeZone: "UTC",
  }).format(date);
}

/** A country name for an ISO 3166-1 alpha-2 code, in the UI language. */
export function formatCountry(code: string, locale: Locale): string {
  return (
    new Intl.DisplayNames([TAG[locale]], { type: "region" }).of(code) ?? code
  );
}

/** A file size in kilobytes, rounded up so a tiny file never shows as 0 KB. */
export function formatKilobytes(bytes: number, locale: Locale): string {
  return new Intl.NumberFormat(TAG[locale], {
    style: "unit",
    unit: "kilobyte",
    maximumFractionDigits: 0,
  }).format(Math.max(1, Math.ceil(bytes / 1024)));
}

export interface PluralForms {
  readonly one: string;
  /** Slovenian dual: 2, 102, ... (falls back to `other`). */
  readonly two?: string;
  /** Slovenian 3-4, 103-104, ... (falls back to `other`). */
  readonly few?: string;
  readonly other: string;
}

/** Picks the plural form for `count` and substitutes it for "{n}". */
export function plural(
  count: number,
  locale: Locale,
  forms: PluralForms,
): string {
  const category = new Intl.PluralRules(TAG[locale]).select(count);
  const form =
    category === "one"
      ? forms.one
      : category === "two"
        ? (forms.two ?? forms.other)
        : category === "few"
          ? (forms.few ?? forms.other)
          : forms.other;
  return form.replace("{n}", formatNumber(String(count), locale));
}
