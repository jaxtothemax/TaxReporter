/**
 * What every eDavki document shares: the EDP-Common-1 header, the taxpayer
 * and the checks on both. The schema makes every taxpayer element optional,
 * the tax number included, but eDavki requires the tax number, so it is
 * checked here (docs/research/01-furs-doh-kdvp.md §3).
 */
import { isIsoDate, type IsoDate } from "@taxreporter/core";

import type { FormIssue } from "./issues.js";
import { element, isXmlText, optional, text, type XmlElement } from "./xml.js";

// One date check for the whole project lives in core; the forms re-export it
// where they always have.
export { isIsoDate, type IsoDate };

export const EDP_NAMESPACE =
  "http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd";

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
export function isTaxNumber(value: unknown): boolean {
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
 * What no FURS text field may hold, since each is one plain line:
 * control characters (tab, CR, LF, NEL and the rest of C0 and C1), the
 * Unicode line and paragraph separators, and format characters. Those are
 * invisible: bidirectional controls that make a name display differently
 * from what it is, zero-width spaces and joiners, soft hyphens, tags.
 */
const NOT_PLAIN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Text from an imported file as a FURS field can carry it. Each character
 * a field refuses (above, or one XML cannot carry at all) becomes a space,
 * runs of whitespace become one space, and the ends are trimmed; undefined
 * when nothing is left. For names the user cannot edit, such as a broker's
 * security names, so that one stray character never blocks a return.
 */
export function toPlainLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let plain = "";
  for (const char of text) {
    plain += isXmlText(char) && !NOT_PLAIN.test(char) ? char : " ";
  }
  const folded = plain.replace(/\s+/g, " ").trim();
  return folded === "" ? undefined : folded;
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
  if (!isXmlText(value) || NOT_PLAIN.test(value)) {
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
