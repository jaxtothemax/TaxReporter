/**
 * What every eDavki document shares: the EDP-Common-1 header, the taxpayer
 * and the checks on both. The schema makes every taxpayer element optional,
 * the tax number included, but eDavki requires the tax number, so it is
 * checked here (docs/research/01-furs-doh-kdvp.md §3).
 */
import type { FormIssue } from "./issues.js";
import { element, isXmlText, optional, text, type XmlElement } from "./xml.js";

export const EDP_NAMESPACE =
  "http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd";

/** An ISO 8601 calendar date, "2026-03-12". */
export type IsoDate = string;

export interface Taxpayer {
  /** Davčna številka: exactly eight digits. */
  readonly taxNumber: string;
  readonly name?: string;
  /** Street and house number (`edp:address1`). */
  readonly address?: string;
  readonly city?: string;
  /** Poštna številka, at most 12 characters. */
  readonly postNumber?: string;
  readonly postName?: string;
  readonly email?: string;
  readonly phone?: string;
}

/**
 * The schema's pattern for `edp:taxNumber`: eight digits, as a positive
 * integer (so not all zeros). A number is refused too, not coerced: a form
 * model can come from JSON.
 */
export function isTaxNumber(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{8}$/.test(value) && /[1-9]/.test(value)
  );
}

/**
 * Whether an optional model value is there. `null`, as JSON writes an
 * absent value, counts as absent, the same as `undefined`.
 */
export function given<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written as YYYY-MM-DD, the only form xs:date takes here. */
export function isIsoDate(value: string): boolean {
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

/** The schema's `typeYear`, [1-9][0-9]{3}; both forms' schemas cover 2013 onward. */
export function isTaxYear(year: number): boolean {
  return Number.isInteger(year) && year >= 2013 && year <= 9999;
}

/**
 * The length limit for text fields whose schema sets none. It is a bound,
 * not a FURS rule: no real name, address or ID comes near it, and it keeps a
 * hostile import from bloating the return.
 */
export const MAX_TEXT_LENGTH = 255;

/** The length the schema's maxLength counts: characters, not UTF-16 units. */
function codePoints(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) i += 1;
    count += 1;
  }
  return count;
}

/**
 * One line, as every FURS text field is: no tab, CR or LF, no Unicode line
 * or paragraph break (NEL, LS, PS), and no bidirectional control, which can
 * make a name display differently from what it is.
 */
function isSingleLine(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (
      unit === 0x09 ||
      unit === 0x0a ||
      unit === 0x0d ||
      unit === 0x85 ||
      unit === 0x2028 ||
      unit === 0x2029 ||
      // Arabic letter mark, left-to-right and right-to-left marks.
      unit === 0x061c ||
      unit === 0x200e ||
      unit === 0x200f ||
      // Embeddings and overrides, then isolates.
      (unit >= 0x202a && unit <= 0x202e) ||
      (unit >= 0x2066 && unit <= 0x2069)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Checks a text field: present when required, a string, writable as XML, a
 * single line, and within the schema's maximum length (or MAX_TEXT_LENGTH).
 * The value is typed `unknown` because a form model can come from JSON.
 */
export function checkText(
  value: unknown,
  path: string,
  issues: FormIssue[],
  options: { readonly required?: boolean; readonly maxLength?: number } = {},
): void {
  if (!given(value)) {
    if (options.required === true) issues.push({ code: "textMissing", path });
    return;
  }
  if (typeof value !== "string") {
    issues.push({ code: "invalidCharacter", path });
    return;
  }
  // Present but blank would become an empty element, which the schema
  // refuses for most types: absent text is left out, never written blank.
  if (value.trim() === "") {
    issues.push({ code: "textMissing", path });
    return;
  }
  if (!isXmlText(value) || !isSingleLine(value)) {
    issues.push({ code: "invalidCharacter", path });
  }
  if (codePoints(value) > (options.maxLength ?? MAX_TEXT_LENGTH)) {
    issues.push({ code: "textTooLong", path });
  }
}

export function checkTaxpayer(taxpayer: Taxpayer, issues: FormIssue[]): void {
  if (!isTaxNumber(taxpayer.taxNumber)) {
    issues.push({ code: "taxNumber", path: "taxpayer.taxNumber" });
  }
  checkText(taxpayer.name, "taxpayer.name", issues);
  checkText(taxpayer.address, "taxpayer.address", issues);
  checkText(taxpayer.city, "taxpayer.city", issues);
  checkText(taxpayer.postNumber, "taxpayer.postNumber", issues, {
    maxLength: 12,
  });
  checkText(taxpayer.postName, "taxpayer.postName", issues);
  checkText(taxpayer.email, "taxpayer.email", issues);
  checkText(taxpayer.phone, "taxpayer.phone", issues);
}

/**
 * `edp:Header` for an original return ("O") filed by an individual ("FO").
 * `domain` is written only where FURS's own template for the form writes it.
 */
export function header(
  taxpayer: Taxpayer,
  options: { readonly domain?: string } = {},
): XmlElement {
  return element("edp:Header", [
    element("edp:taxpayer", [
      text("edp:taxNumber", taxpayer.taxNumber),
      text("edp:taxpayerType", "FO"),
      optional("edp:name", taxpayer.name),
      optional("edp:address1", taxpayer.address),
      optional("edp:city", taxpayer.city),
      optional("edp:postNumber", taxpayer.postNumber),
      optional("edp:postName", taxpayer.postName),
    ]),
    element("edp:Workflow", [text("edp:DocumentWorkflowID", "O")]),
    optional("edp:domain", options.domain),
  ]);
}
