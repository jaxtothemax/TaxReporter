/**
 * Reads Banka Slovenije's rate history files, `dtecbs-l.xml` (the daily
 * list, a copy of the ECB reference rates) and `EksotTecBS-l.xml` (the
 * monthly list of other currencies), as published at
 * https://www.bsi.si/_data/tecajnice/ (docs/research/03-bsi-exchange-rates.md
 * §4–§5).
 *
 * A strict scanner, not a general XML parser: it accepts exactly the shape
 * BSI publishes and refuses anything else, so a change in BSI's format stops
 * the snapshot build instead of slipping through. It never resolves a DTD or
 * an entity; a DOCTYPE is refused outright (CLAUDE.md, "Secure code"). Each
 * rate keeps BSI's own string, trailing zeros included.
 */

export interface PublishedList {
  /** `datum`: the reference date of the list. */
  readonly date: string;
  /** Monthly lists only: `veljavnost`, the 1st of the month the list serves. */
  readonly validFrom?: string;
  /** Currency code → the rate as BSI wrote it (units of currency per 1 EUR). */
  readonly rates: ReadonlyMap<string, string>;
}

/** Far above the real files (7.7 MB and 1.4 MB in October 2026). */
export const MAX_SOURCE_LENGTH = 64 * 1024 * 1024;

const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const RATE = String.raw`\d{1,12}(?:\.\d{1,12})?`;

function scan(
  xml: string,
  root: "DtecBS" | "EksotTecBS",
  listOpen: RegExp,
): PublishedList[] {
  if (xml.length > MAX_SOURCE_LENGTH) {
    throw new Error(`BSI ${root} file is larger than expected`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(`BSI ${root} file declares a DOCTYPE; refused`);
  }
  const head = new RegExp(
    String.raw`^\uFEFF?<\?xml version="1\.0"(?: encoding="(?:UTF-8|utf-8)")?\?>\s*<${root} xmlns="http://www\.bsi\.si"[^<>]*>`,
  ).exec(xml);
  if (head === null) throw new Error(`Not a BSI ${root} file`);

  const token = new RegExp(
    String.raw`\s*(?:${listOpen.source}|(</tecajnica>)|<tecaj oznaka="([A-Z]{3})" sifra="(\d{3})">(${RATE})</tecaj>|(</${root}>))`,
    "y",
  );
  const lists: PublishedList[] = [];
  let current: {
    date: string;
    validFrom?: string;
    rates: Map<string, string>;
  } | null = null;
  let position = head[0].length;
  for (;;) {
    token.lastIndex = position;
    const match = token.exec(xml);
    if (match === null) {
      throw new Error(
        `Unexpected content in BSI ${root} file at offset ${String(position)}`,
      );
    }
    position = token.lastIndex;
    const [, date, validFrom, close, code, , rate, end] = match;
    if (date !== undefined) {
      if (current !== null) throw new Error("Nested tecajnica in BSI file");
      current = {
        date,
        ...(validFrom === undefined ? {} : { validFrom }),
        rates: new Map(),
      };
    } else if (close !== undefined) {
      if (current === null) throw new Error("Unbalanced tecajnica in BSI file");
      lists.push(current);
      current = null;
    } else if (code !== undefined && rate !== undefined) {
      if (current === null) throw new Error("Rate outside a list in BSI file");
      if (current.rates.has(code)) {
        throw new Error(
          `Currency listed twice in one BSI list (${current.date})`,
        );
      }
      current.rates.set(code, rate);
    } else if (end !== undefined) {
      if (current !== null) throw new Error("Unclosed tecajnica in BSI file");
      if (xml.slice(position).trim() !== "") {
        throw new Error(`Content after the end of the BSI ${root} file`);
      }
      return lists;
    }
  }
}

/** The daily list history, oldest first. */
export function parseDailyXml(xml: string): PublishedList[] {
  // `((?!))?` is a group that never takes part, so the daily list's missing
  // veljavnost comes out undefined, as the monthly scanner's second group.
  return scan(
    xml,
    "DtecBS",
    new RegExp(String.raw`<tecajnica datum="(${DATE})">((?!))?`),
  );
}

/** The monthly list history, oldest first. */
export function parseMonthlyXml(xml: string): PublishedList[] {
  return scan(
    xml,
    "EksotTecBS",
    new RegExp(
      String.raw`<tecajnica datum="(${DATE})" veljavnost="(${DATE})">`,
    ),
  );
}
