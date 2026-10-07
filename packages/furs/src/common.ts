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
 * integer (so not all zeros).
 */
export function isTaxNumber(value: string): boolean {
  return /^\d{8}$/.test(value) && /[1-9]/.test(value);
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
 * Checks a text field: present when required, writable as XML, a single line
 * (every FURS text field is), and within the schema's maximum length.
 */
export function checkText(
  value: string | undefined,
  path: string,
  issues: FormIssue[],
  options: { readonly required?: boolean; readonly maxLength?: number } = {},
): void {
  if (value === undefined || value.trim() === "") {
    if (options.required === true) issues.push({ code: "textMissing", path });
    else if (value !== undefined) issues.push({ code: "textMissing", path });
    return;
  }
  if (!isXmlText(value) || /[\r\n\t]/.test(value)) {
    issues.push({ code: "invalidCharacter", path });
  }
  if (
    options.maxLength !== undefined &&
    codePoints(value) > options.maxLength
  ) {
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
