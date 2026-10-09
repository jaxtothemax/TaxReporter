/**
 * The one way into an XLSX workbook (ADR 0014 §5–7). Every file is hostile
 * (CLAUDE.md, "Secure code"), so this reads a workbook only as Excel lays
 * one out, refuses what it cannot read the way Excel would, and inflates
 * nothing it does not need:
 *
 * - the package as OPC defines it: `_rels/.rels` names one office
 *   document, `[Content_Types].xml` gives every part read its type, and
 *   relationships resolve to parts inside the file, never outside;
 * - the workbook's sheets, by name, position and whether hidden, and its
 *   date system; a macro-enabled, binary or Strict workbook is refused for
 *   what it is;
 * - a worksheet's rows only when an adapter asks for that sheet, as typed
 *   cells, each with its exact stored text, stored sparsely: nothing is
 *   allocated from a count or a reference the file states;
 * - one budget for the whole file: the bytes inflated (the ZIP reader's),
 *   the XML elements scanned, and the rows, cells and characters read.
 *
 * Every part is read with the OOXML profile of the strict XML scanner.
 * Inside `sheetData` and `sst` only the elements a cell or a string is made
 * of are allowed; anything else, foreign or not, is refused. Outside them,
 * what the reader does not read is skipped whole, as Excel writes much of
 * it (`extLst`, `headerFooter`, defined names). Errors name a rule and a
 * place (sheet position, row, column), never a part name, a sheet name or
 * a value.
 */
import {
  LIMITS,
  type FileRefusal,
  type XlsxReason,
  type XmlReason,
  type ZipReason,
} from "@taxreporter/core";

import { decodeUtf8 } from "./intake.js";
import { scanXml, XmlError, type XmlElement, type XmlVisitor } from "./xml.js";
import { cellNumber } from "./xlsx-values.js";
import { openZip, ZipError, type ZipArchive, type ZipEntry } from "./zip.js";

export type WorkbookReason = ZipReason | XmlReason | XlsxReason;

/** A workbook refused for what it is, not for damage. */
export type WorkbookRefusal = Extract<
  FileRefusal,
  "zip" | "macroWorkbook" | "binaryWorkbook" | "strictWorkbook"
>;

export class XlsxError extends Error {
  constructor(
    readonly code: WorkbookReason,
    /** The sheet's position in the workbook, from 1; 0 for none. */
    readonly sheet = 0,
    /** The row, from 1; 0 for none. */
    readonly row = 0,
    /** The column, from 1 (A); 0 for none. */
    readonly column = 0,
  ) {
    super(`XLSX workbook refused (${code})`);
  }
}

/** A sheet as the workbook lists it. */
export interface WorkbookSheet {
  /** Its place in the workbook's list, from 1. */
  readonly position: number;
  /**
   * Exactly as written, trailing spaces included. File text: an adapter
   * matches it against its own closed list and never shows it.
   */
  readonly name: string;
  /** Hidden in Excel (`hidden` or `veryHidden`). */
  readonly hidden: boolean;
  /** A worksheet, with cells; a chart sheet has none. */
  readonly worksheet: boolean;
}

/** What choosing an adapter may see: nothing has been inflated for it. */
export interface WorkbookInfo {
  readonly sheets: readonly WorkbookSheet[];
  /** The 1904 date system (`workbookPr date1904`), else the 1900 one. */
  readonly date1904: boolean;
}

/** One cell, typed, with the text it stores. */
export type Cell =
  | {
      readonly kind: "number";
      /** The stored text, exactly: what a serial or an identifier is read from. */
      readonly text: string;
      /** The value as a plain decimal, at 15 significant digits (ADR 0014 §8). */
      readonly value: string;
    }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "boolean"; readonly text: string; readonly value: boolean }
  | { readonly kind: "error"; readonly text: string };

/** A row that holds at least one cell, its cells by column from 1 (A). */
export interface SheetRow {
  readonly row: number;
  readonly cells: ReadonlyMap<number, Cell>;
}

export interface SheetRows {
  readonly rows: readonly SheetRow[];
  /** Whether any row or column of the sheet is hidden in Excel. */
  readonly hiddenCells: boolean;
}

export interface Workbook extends WorkbookInfo {
  /**
   * A sheet's rows, inflated and read the first time they are asked for.
   * Throws XlsxError when the sheet cannot be read; a chart sheet has none.
   */
  rows(position: number): SheetRows;
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/** Markup Compatibility: content Excel may apply in place of what follows. */
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
/** Its attributes that make a consumer process or require what it skips. */
const MC_DIRECTIVES = [`{${MC}}ProcessContent`, `{${MC}}MustUnderstand`];
/** `xml:space`, by its resolved name. */
const XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space";
const RELATIONSHIPS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const MICROSOFT_RELATIONSHIPS =
  "http://schemas.microsoft.com/office/2006/relationships";

const TYPE = {
  officeDocument: `${RELATIONSHIPS}/officeDocument`,
  worksheet: `${RELATIONSHIPS}/worksheet`,
  chartsheet: `${RELATIONSHIPS}/chartsheet`,
  dialogsheet: `${RELATIONSHIPS}/dialogsheet`,
  sharedStrings: `${RELATIONSHIPS}/sharedStrings`,
  strictOfficeDocument:
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
};

/** Relationships to macros, of any part: refused whatever points at them. */
const MACRO_RELATIONSHIPS: ReadonlySet<string> = new Set([
  `${MICROSOFT_RELATIONSHIPS}/vbaProject`,
  `${MICROSOFT_RELATIONSHIPS}/xlMacrosheet`,
  `${MICROSOFT_RELATIONSHIPS}/xlIntlMacrosheet`,
]);

/** Content types, compared in lower case, as MIME types are. */
const CONTENT = {
  workbook:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  binaryWorkbook: "application/vnd.ms-excel.sheet.binary.macroenabled.main",
  worksheet:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  sharedStrings:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml",
};

/** Content types that carry macros, declared anywhere in the package. */
const MACRO_CONTENT: ReadonlySet<string> = new Set([
  "application/vnd.ms-office.vbaproject",
  "application/vnd.ms-excel.sheet.macroenabled.main+xml",
  "application/vnd.ms-excel.template.macroenabled.main+xml",
  "application/vnd.ms-excel.addin.macroenabled.main+xml",
  "application/vnd.ms-excel.macrosheet+xml",
  "application/vnd.ms-excel.intlmacrosheet+xml",
]);

/**
 * A relationship target as a part's address: path characters only, no
 * scheme, query, fragment, percent-encoding or backslash.
 */
const TARGET = /^[A-Za-z0-9._~!$&'()*+,;=@/-]{1,256}$/;
/** An A1 reference: up to three letters and seven digits, no leading zero. */
const CELL_REFERENCE = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const ROW_REFERENCE = /^[1-9][0-9]{0,6}$/;
/** A shared-string index as Excel writes one: canonical digits. */
const INDEX = /^(?:0|[1-9][0-9]{0,8})$/;
const SHEET_ID = /^[1-9][0-9]{0,9}$/;
const ESCAPE = /_x([0-9A-Fa-f]{4})_/g;

/** Excel's grid (research 09 §3). */
const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;
/** Characters in a sheet's name (research 09 §3). */
const MAX_SHEET_NAME = 31;

/** Excel's error values, the closed list a cell of type `e` may hold. */
const ERRORS: ReadonlySet<string> = new Set([
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#GETTING_DATA",
  "#SPILL!",
  "#CALC!",
  "#FIELD!",
  "#BLOCKED!",
  "#CONNECT!",
  "#UNKNOWN!",
  "#BUSY!",
]);

const isSpace = (c: number) =>
  c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

function isBlank(text: string): boolean {
  for (let k = 0; k < text.length; k += 1) {
    if (!isSpace(text.charCodeAt(k))) return false;
  }
  return true;
}

/** XML 1.0's Char production, by code point. */
function isXmlChar(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * A piece of text as Excel shows it: its `_xHHHH_` escapes decoded, as
 * ECMA-376 `ST_Xstring` defines them (`_x005F_` keeps an underscore); null
 * if one names no character: a lone surrogate, or a control character XML
 * could not carry either.
 */
function unescape(text: string): string | null {
  if (!text.includes("_x")) return text;
  const decoded = text.replace(ESCAPE, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  for (let k = 0; k < decoded.length;) {
    const code = decoded.codePointAt(k) as number;
    if (!isXmlChar(code)) return null;
    k += code > 0xffff ? 2 : 1;
  }
  return decoded;
}

/** Lower case for the ASCII letters alone: no other letter folds into one. */
const asciiLower = (text: string) =>
  text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

/** An escape is 7 characters for 1: no string's text is written longer. */
const MAX_WRITTEN = 7 * LIMITS.xlsxCellLength;

/** What reads the parts of one string: a shared string, an inline one. */
interface StringParts {
  open(element: XmlElement): Step;
  close(depth: number): void;
  text(value: string, depth: number): void;
  /** The string, once its root element has closed. */
  value(): string;
}

/**
 * A string's text as Excel builds it (ECMA-376 §18.4): one `t`, or runs
 * (`r`) of at most one `t` each, their properties skipped; phonetic guides
 * (`rPh`) are not its text. Nothing stands inside a `t`; each `t` is
 * unescaped on its own, as Excel decodes it, its white space kept, and the
 * whole held to LIMITS.xlsxCellLength.
 */
function stringParts(
  root: number,
  fail: (code: XlsxReason) => never,
): StringParts {
  const parts: string[] = [];
  const state = {
    piece: null as string[] | null,
    pieceDepth: 0,
    direct: false,
    runs: 0,
    runText: false,
    written: 0,
    length: 0,
    preserve: false,
  };
  const startPiece = (e: XmlElement): Step => {
    state.piece = [];
    state.pieceDepth = e.depth;
    state.preserve = e.attributes.get(XML_SPACE) === "preserve";
    return "enter";
  };
  return {
    open(e) {
      if (state.piece !== null || e.namespace !== MAIN) {
        return fail("xlsxStructure");
      }
      const level = e.depth - root;
      if (level === 1) {
        if (e.local === "rPh" || e.local === "phoneticPr") return "skip";
        if (e.local === "t" && !state.direct && state.runs === 0) {
          state.direct = true;
          return startPiece(e);
        }
        if (e.local === "r" && !state.direct) {
          state.runs += 1;
          state.runText = false;
          return "enter";
        }
      } else if (level === 2) {
        if (e.local === "rPr") return "skip";
        if (e.local === "t" && !state.runText) {
          state.runText = true;
          return startPiece(e);
        }
      }
      return fail("xlsxStructure");
    },
    close(depth) {
      if (state.piece === null || depth !== state.pieceDepth) return;
      const written = state.piece.join("");
      // Space at the edge of a `t` is kept only under xml:space="preserve",
      // which every writer sets where it means it; without it a consumer
      // may drop it, so the text is refused rather than read either way.
      if (
        !state.preserve &&
        written !== "" &&
        (isSpace(written.charCodeAt(0)) ||
          isSpace(written.charCodeAt(written.length - 1)))
      ) {
        return fail("xlsxText");
      }
      const decoded = unescape(written);
      if (decoded === null) return fail("xlsxText");
      state.length += decoded.length;
      if (state.length > LIMITS.xlsxCellLength) fail("xlsxText");
      parts.push(decoded);
      state.piece = null;
    },
    text(value, depth) {
      if (state.piece === null || depth !== state.pieceDepth) {
        if (!isBlank(value)) fail("xlsxStructure");
        return;
      }
      state.written += value.length;
      if (state.written > MAX_WRITTEN) fail("xlsxText");
      state.piece.push(value);
    },
    value: () => parts.join(""),
  };
}

/**
 * What a visitor does with an element: reads it and what it holds, or
 * skips it whole, its text and its children unseen.
 */
type Step = "enter" | "skip";

interface Reader {
  open(element: XmlElement): Step;
  close?(depth: number): void;
  /**
   * Text inside an element entered, white space alone included; without
   * this, white space passes and any other text is refused.
   */
  text?(value: string, depth: number): void;
}

/** A scanner visitor that runs `reader` outside the subtrees it skips. */
function visitor(reader: Reader, refuse: () => never): XmlVisitor {
  /** The depth of the element being skipped; 0 while none is. */
  let skipping = 0;
  return {
    open(element) {
      if (skipping !== 0) return;
      // A consumer that applies Markup Compatibility would read content
      // these name, which the reader skips (ADR 0014 §4).
      if (MC_DIRECTIVES.some((name) => element.attributes.has(name))) refuse();
      if (reader.open(element) === "skip") skipping = element.depth;
    },
    close(_name, depth) {
      if (skipping !== 0) {
        if (depth === skipping) skipping = 0;
        return;
      }
      reader.close?.(depth);
    },
    text(value, depth) {
      if (skipping !== 0) return;
      // White space reaches a reader that reads text, as a single space
      // between runs is text; the reader ignores it outside `t` and `v`.
      if (reader.text !== undefined) reader.text(value, depth);
      else if (!isBlank(value)) refuse();
    },
  };
}

const is = (element: XmlElement, namespace: string, local: string) =>
  element.namespace === namespace && element.local === local;

/**
 * An element inside an mc:AlternateContent outside sheetData and sst: its
 * Choice and Fallback are read, so that SpreadsheetML's own elements in
 * them, which a consumer applying the choice would take for the part's
 * (another date system, a second sheetData), are refused; Excel's
 * extensions there, such as the workbook's absPath, are skipped.
 */
function alternative(e: XmlElement, depth: number, refuse: () => never): Step {
  if (e.namespace === MAIN) return refuse();
  if (
    e.depth === depth + 1 &&
    e.namespace === MC &&
    (e.local === "Choice" || e.local === "Fallback")
  ) {
    return "enter";
  }
  return "skip";
}

/** A relationship of a part, its target not yet resolved. */
interface Relationship {
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

/** A part's folder, "xl/" for "xl/workbook.xml", "" for the root. */
const folderOf = (name: string) => name.slice(0, name.lastIndexOf("/") + 1);

/** The relationships part of a part: "xl/_rels/workbook.xml.rels". */
const relationshipsOf = (name: string) =>
  `${folderOf(name)}_rels/${name.slice(name.lastIndexOf("/") + 1)}.rels`;

/**
 * A target as the ZIP entry name of the part it names, resolved as OPC
 * resolves it: against the source part's folder unless it starts at the
 * root, dot segments removed. Null for one that leaves the package.
 */
function resolve(folder: string, target: string): string | null {
  if (!TARGET.test(target)) return null;
  const path = target.startsWith("/") ? target.slice(1) : folder + target;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "") return null;
    if (segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
}

/** One workbook file's budget, shared by every part of it that is read. */
interface Budget {
  readonly scan: { elements: number };
  rows: number;
  cells: number;
  characters: number;
}

/** Scans one part with the OOXML profile, its errors named by `sheet`. */
function scanPart(
  bytes: Uint8Array,
  reader: Reader,
  budget: Budget,
  sheet: number,
  refusal: XlsxReason,
): void {
  const text = decodeUtf8(bytes);
  if (text === null) throw new XlsxError("xlsxEncoding", sheet);
  const refuse = (): never => {
    throw new XlsxError(refusal, sheet);
  };
  try {
    scanXml(text, visitor(reader, refuse), {
      ooxml: true,
      budget: budget.scan,
    });
  } catch (error) {
    if (error instanceof XmlError) throw new XlsxError(error.code, sheet);
    throw error;
  }
}

/** `[Content_Types].xml`: each part's type by name, else by extension. */
function readContentTypes(
  bytes: Uint8Array,
  budget: Budget,
): (name: string) => string | undefined {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const refuse = (): never => {
    throw new XlsxError("xlsxPackage");
  };
  scanPart(
    bytes,
    {
      open(e) {
        if (e.depth === 1)
          return is(e, CONTENT_TYPES, "Types") ? "enter" : refuse();
        if (e.depth !== 2) return "skip";
        const written = e.attributes.get("ContentType");
        const type = written === undefined ? undefined : asciiLower(written);
        if (is(e, CONTENT_TYPES, "Default")) {
          const raw = e.attributes.get("Extension");
          const extension = raw === undefined ? undefined : asciiLower(raw);
          if (type === undefined || extension === undefined) refuse();
          if (defaults.has(extension as string)) refuse();
          defaults.set(extension as string, type as string);
        } else if (is(e, CONTENT_TYPES, "Override")) {
          const raw = e.attributes.get("PartName");
          const part = raw === undefined ? undefined : asciiLower(raw);
          if (type === undefined || part === undefined) refuse();
          if (overrides.has(part as string)) refuse();
          overrides.set(part as string, type as string);
        }
        return "skip";
      },
    },
    budget,
    0,
    "xlsxPackage",
  );
  const all = [...defaults.values(), ...overrides.values()];
  if (all.some((type) => MACRO_CONTENT.has(type))) {
    // A macro anywhere in the package refuses it, read or not.
    throw new MacroFound();
  }
  return (name) => {
    const part = asciiLower(`/${name}`);
    const override = overrides.get(part);
    if (override !== undefined) return override;
    const file = part.slice(part.lastIndexOf("/") + 1);
    const dot = file.lastIndexOf(".");
    return dot === -1 ? undefined : defaults.get(file.slice(dot + 1));
  };
}

/** Thrown inside, where a macro is found, and turned into the refusal. */
class MacroFound extends Error {}

/** A relationships part, by relationship ID. */
function readRelationships(
  bytes: Uint8Array,
  budget: Budget,
): ReadonlyMap<string, Relationship> {
  const relationships = new Map<string, Relationship>();
  const refuse = (): never => {
    throw new XlsxError("xlsxPackage");
  };
  scanPart(
    bytes,
    {
      open(e) {
        if (e.depth === 1) {
          return is(e, PACKAGE_RELATIONSHIPS, "Relationships")
            ? "enter"
            : refuse();
        }
        if (e.depth !== 2 || !is(e, PACKAGE_RELATIONSHIPS, "Relationship")) {
          return "skip";
        }
        const id = e.attributes.get("Id");
        const type = e.attributes.get("Type");
        const target = e.attributes.get("Target");
        const mode = e.attributes.get("TargetMode") ?? "Internal";
        if (id === undefined || type === undefined || target === undefined) {
          refuse();
        }
        if (relationships.has(id as string)) refuse();
        if (mode !== "Internal" && mode !== "External") refuse();
        if (MACRO_RELATIONSHIPS.has(type as string)) throw new MacroFound();
        relationships.set(id as string, {
          type: type as string,
          target: target as string,
          external: mode === "External",
        });
        return "skip";
      },
    },
    budget,
    0,
    "xlsxPackage",
  );
  return relationships;
}

/** A sheet as the workbook part lists it, its relationship not resolved. */
interface ListedSheet {
  readonly name: string;
  readonly hidden: boolean;
  readonly id: string;
}

function readWorkbookPart(
  bytes: Uint8Array,
  budget: Budget,
): { sheets: ListedSheet[]; date1904: boolean } {
  const sheets: ListedSheet[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  // One object, as the visitor sets these: a plain `let` would be narrowed
  // to its first value where it is read after the scan.
  const seen = {
    date1904: false,
    properties: false,
    sheets: false,
    /** The depth of an mc:AlternateContent being read; 0 outside one. */
    alternate: 0,
    /** The part of the workbook being read. */
    section: null as "sheets" | "views" | null,
    /** A workbook window hidden: every sheet is out of sight. */
    hiddenWindow: false,
  };
  const refuse = (sheet = 0): never => {
    throw new XlsxError("xlsxWorkbook", sheet);
  };
  scanPart(
    bytes,
    {
      open(e) {
        if (e.depth === 1) return is(e, MAIN, "workbook") ? "enter" : refuse();
        if (seen.alternate !== 0) {
          return alternative(e, seen.alternate, () => refuse());
        }
        if (e.depth === 2 && is(e, MC, "AlternateContent")) {
          seen.alternate = e.depth;
          return "enter";
        }
        if (e.depth === 2) {
          if (is(e, MAIN, "workbookPr")) {
            if (seen.properties) refuse();
            seen.properties = true;
            const value = e.attributes.get("date1904") ?? "false";
            // An XML Schema boolean (research 09 §2).
            if (value === "1" || value === "true") seen.date1904 = true;
            else if (value !== "0" && value !== "false") refuse();
            // A 1900 date base other than Excel's own is not read on a
            // guess (research 09 §2).
            const compatibility = e.attributes.get("dateCompatibility");
            if (
              compatibility !== undefined &&
              compatibility !== "1" &&
              compatibility !== "true"
            ) {
              refuse();
            }
            return "skip";
          }
          if (is(e, MAIN, "sheets")) {
            if (seen.sheets) refuse();
            seen.sheets = true;
            seen.section = "sheets";
            return "enter";
          }
          if (is(e, MAIN, "bookViews")) {
            seen.section = "views";
            return "enter";
          }
          return "skip";
        }
        if (seen.section === "views") {
          const visibility = e.attributes.get("visibility");
          if (
            is(e, MAIN, "workbookView") &&
            (visibility === "hidden" || visibility === "veryHidden")
          ) {
            seen.hiddenWindow = true;
          }
          return "skip";
        }
        // Inside <sheets>: sheets, and nothing that could hide one.
        if (e.depth !== 3 || !is(e, MAIN, "sheet")) return refuse();
        const position = sheets.length + 1;
        if (position > LIMITS.sheetsPerFile) {
          throw new XlsxError("xlsxSheets");
        }
        const name = e.attributes.get("name");
        const sheetId = e.attributes.get("sheetId");
        const id = e.attributes.get(`{${RELATIONSHIPS}}id`);
        const state = e.attributes.get("state") ?? "visible";
        if (name === undefined || sheetId === undefined || id === undefined) {
          refuse(position);
        }
        if (!SHEET_ID.test(sheetId as string) || ids.has(sheetId as string)) {
          refuse(position);
        }
        ids.add(sheetId as string);
        if (
          state !== "visible" &&
          state !== "hidden" &&
          state !== "veryHidden"
        ) {
          refuse(position);
        }
        const key = (name as string).toLowerCase();
        if (
          name === "" ||
          (name as string).length > MAX_SHEET_NAME ||
          names.has(key)
        ) {
          throw new XlsxError("xlsxSheetName", position);
        }
        names.add(key);
        sheets.push({
          name: name as string,
          hidden: state !== "visible",
          id: id as string,
        });
        return "skip";
      },
      close(depth) {
        if (depth === seen.alternate) seen.alternate = 0;
        if (depth === 2) seen.section = null;
      },
    },
    budget,
    0,
    "xlsxWorkbook",
  );
  if (seen.hiddenWindow) {
    for (const [index, sheet] of sheets.entries()) {
      sheets[index] = { ...sheet, hidden: true };
    }
  }
  if (!seen.sheets) refuse();
  return { sheets, date1904: seen.date1904 };
}

/** The shared-string table, each string read as `stringParts` reads it. */
function readSharedStrings(bytes: Uint8Array, budget: Budget): string[] {
  const strings: string[] = [];
  const at = { current: null as StringParts | null };
  const fail = (code: XlsxReason): never => {
    throw new XlsxError(code);
  };
  scanPart(
    bytes,
    {
      open(e) {
        if (e.depth === 1) {
          return is(e, MAIN, "sst") ? "enter" : fail("xlsxStructure");
        }
        if (at.current !== null) return at.current.open(e);
        if (e.namespace !== MAIN) return fail("xlsxStructure");
        if (e.local === "extLst") return "skip";
        if (e.local !== "si") return fail("xlsxStructure");
        if (strings.length >= LIMITS.sharedStrings) fail("xlsxSharedStrings");
        at.current = stringParts(e.depth, fail);
        return "enter";
      },
      close(depth) {
        if (at.current === null) return;
        if (depth === 2) {
          strings.push(at.current.value());
          at.current = null;
        } else {
          at.current.close(depth);
        }
      },
      text(value, depth) {
        if (at.current !== null) at.current.text(value, depth);
        else if (!isBlank(value)) fail("xlsxStructure");
      },
    },
    budget,
    0,
    "xlsxStructure",
  );
  return strings;
}

const truthy = (value: string | undefined) => value === "1" || value === "true";

/** A height or width of zero, which hides a row or column as surely. */
const isZero = (value: string | undefined) =>
  value !== undefined && /^0*(?:\.0*)?$/.test(value) && value !== "";

/** A column's letters as its number: A is 1, XFD is 16,384. */
function columnOf(letters: string): number {
  let column = 0;
  for (let k = 0; k < letters.length; k += 1) {
    column = column * 26 + (letters.charCodeAt(k) - 0x40);
  }
  return column;
}

/** One worksheet's rows, read against the file's budget. */
function readSheet(
  bytes: Uint8Array,
  position: number,
  strings: readonly string[],
  budget: Budget,
): SheetRows {
  const rows: SheetRow[] = [];
  let hiddenCells = false;
  /** The part of the worksheet being read. */
  let section: "cols" | "sheetData" | null = null;
  /** How many sheetData the worksheet has: exactly one is read. */
  let sheetData = 0;
  /** The depth of an mc:AlternateContent being read; 0 outside one. */
  let alternate = 0;
  /** The row being read, and the last column in it. */
  let row = 0;
  let column = 0;
  let cells = new Map<number, Cell>();
  /** The cell being read. */
  let type = "n";
  let value: string | null = null;
  let inValue = false;
  let inline: StringParts | null = null;
  const fail = (code: XlsxReason, at = column): never => {
    throw new XlsxError(code, position, row, at);
  };
  const refuse = (): never => fail("xlsxStructure");

  const cellOf = (): Cell | null => {
    if (inline !== null) {
      // An inline string, and nothing else: no value beside it.
      if (type !== "inlineStr" || value !== null) fail("xlsxCellType");
      return { kind: "string", text: inline.value() };
    }
    if (value === null) return null;
    switch (type) {
      case "n": {
        const number = cellNumber(value);
        if (number === null) return fail("xlsxNumber");
        return { kind: "number", text: value, value: number };
      }
      case "s": {
        if (!INDEX.test(value)) return fail("xlsxSharedStrings");
        const index = Number(value);
        if (index >= strings.length) return fail("xlsxSharedStrings");
        return { kind: "string", text: strings[index] as string };
      }
      case "str": {
        const text = unescape(value);
        if (text === null) return fail("xlsxText");
        return { kind: "string", text };
      }
      case "b":
        if (value !== "0" && value !== "1") return fail("xlsxCellType");
        return { kind: "boolean", text: value, value: value === "1" };
      case "e":
        if (!ERRORS.has(value)) return fail("xlsxCellType");
        return { kind: "error", text: value };
      default:
        // An inline string's value is in <is>; a date cell (`d`) and any
        // other type are not read.
        return fail("xlsxCellType");
    }
  };

  scanPart(
    bytes,
    {
      open(e) {
        if (e.depth === 1) {
          return is(e, MAIN, "worksheet") ? "enter" : refuse();
        }
        if (alternate !== 0) return alternative(e, alternate, refuse);
        if (e.depth === 2) {
          if (is(e, MC, "AlternateContent")) {
            alternate = e.depth;
            return "enter";
          }
          if (is(e, MAIN, "sheetData")) {
            sheetData += 1;
            if (sheetData > 1) refuse();
            section = "sheetData";
          } else if (is(e, MAIN, "cols")) {
            section = "cols";
          } else {
            // Rows hidden, or columns of no width, unless set otherwise.
            if (
              is(e, MAIN, "sheetFormatPr") &&
              (truthy(e.attributes.get("zeroHeight")) ||
                isZero(e.attributes.get("defaultColWidth")))
            ) {
              hiddenCells = true;
            }
            return "skip";
          }
          return "enter";
        }
        if (section === "cols") {
          // Columns, read only for whether one is hidden or of no width;
          // one in an alternative is refused, as anywhere outside it.
          if (is(e, MC, "AlternateContent")) {
            alternate = e.depth;
            return "enter";
          }
          if (
            is(e, MAIN, "col") &&
            (truthy(e.attributes.get("hidden")) ||
              isZero(e.attributes.get("width")))
          ) {
            hiddenCells = true;
          }
          return "skip";
        }
        // Inside <sheetData>: rows, cells and what a cell is made of, in
        // SpreadsheetML's own namespace, and nothing else.
        if (e.namespace !== MAIN) return refuse();
        if (e.depth === 3) {
          if (e.local !== "row") return refuse();
          const r = e.attributes.get("r");
          let next = row + 1;
          if (r !== undefined) {
            if (!ROW_REFERENCE.test(r)) {
              throw new XlsxError("xlsxReference", position);
            }
            next = Number(r);
          }
          if (next > MAX_ROW) throw new XlsxError("xlsxReference", position);
          // Out of order or repeated: refused where it stands.
          if (next <= row) throw new XlsxError("xlsxReference", position, next);
          budget.rows += 1;
          if (budget.rows > LIMITS.recordsPerFile) fail("xlsxRows", 0);
          row = next;
          column = 0;
          cells = new Map();
          if (
            truthy(e.attributes.get("hidden")) ||
            isZero(e.attributes.get("ht"))
          ) {
            hiddenCells = true;
          }
          return "enter";
        }
        if (e.depth === 4) {
          if (e.local !== "c") return refuse();
          const r = e.attributes.get("r");
          let next = column + 1;
          if (r !== undefined) {
            const match = CELL_REFERENCE.exec(r);
            if (match === null) return fail("xlsxReference", 0);
            next = columnOf(match[1] as string);
            if (next > MAX_COLUMN) fail("xlsxReference", 0);
            // A cell outside its row, out of order, or repeated.
            if (Number(match[2]) !== row) fail("xlsxReference", next);
          }
          if (next > MAX_COLUMN) fail("xlsxReference", 0);
          if (next <= column) fail("xlsxReference", next);
          column = next;
          if (column > LIMITS.columns) fail("xlsxColumns");
          budget.cells += 1;
          if (budget.cells > LIMITS.cellsPerFile) fail("xlsxCells");
          // Metadata can make Excel show something other than the value.
          if (e.attributes.has("cm") || e.attributes.has("vm")) {
            fail("xlsxCellType");
          }
          type = e.attributes.get("t") ?? "n";
          value = null;
          inline = null;
          return "enter";
        }
        if (e.depth === 5) {
          if (e.local === "f") fail("xlsxFormula");
          if (e.local === "v") {
            if (value !== null) refuse();
            value = "";
            inValue = true;
            return "enter";
          }
          if (e.local === "is") {
            if (inline !== null) refuse();
            inline = stringParts(e.depth, (code) => fail(code));
            return "enter";
          }
          return refuse();
        }
        // Inside a value nothing stands; an inline string has its parts.
        if (inValue || inline === null) return refuse();
        return inline.open(e);
      },
      close(depth) {
        if (depth === alternate) alternate = 0;
        if (depth === 2) section = null;
        // Rows and cells close only inside sheetData: an mc:Choice after
        // it closes at the depth a row does.
        if (section !== "sheetData") return;
        if (depth === 5) inValue = false;
        else if (depth > 5) inline?.close(depth);
        if (depth === 4) {
          const cell = cellOf();
          if (cell === null) return;
          if (cell.kind === "string") {
            budget.characters += cell.text.length;
            if (budget.characters > LIMITS.fileBytes) fail("xlsxText");
          }
          cells.set(column, cell);
        } else if (depth === 3 && cells.size > 0) {
          rows.push({ row, cells });
        }
      },
      text(text, depth) {
        if (inValue && depth === 5) {
          value = (value ?? "") + text;
          if (value.length > LIMITS.xlsxCellLength) fail("xlsxText");
        } else if (inline !== null && depth > 5) {
          inline.text(text, depth);
        } else if (!isBlank(text)) {
          refuse();
        }
      },
    },
    budget,
    position,
    "xlsxStructure",
  );
  // One sheetData, read; none, or one Excel would take from elsewhere, is
  // no sheet to read.
  if (sheetData !== 1) throw new XlsxError("xlsxStructure", position);
  return { rows, hiddenCells };
}

/** A sheet as found: listed, and where its part is when it has one. */
interface FoundSheet extends WorkbookSheet {
  readonly entry: ZipEntry | null;
}

/**
 * Opens a workbook: its package, its sheet list and date system, nothing
 * more. A ZIP that is no XLSX workbook comes back as the reason it is
 * refused; a damaged one throws XlsxError.
 */
export function openWorkbook(bytes: Uint8Array): Workbook | WorkbookRefusal {
  try {
    return open(bytes);
  } catch (error) {
    if (error instanceof MacroFound) return "macroWorkbook";
    if (error instanceof ZipError) throw new XlsxError(error.code);
    throw error;
  }
}

function open(bytes: Uint8Array): Workbook | WorkbookRefusal {
  const archive = openZip(bytes);
  const budget: Budget = {
    scan: { elements: LIMITS.xlsxElements },
    rows: 0,
    cells: 0,
    characters: 0,
  };
  const types = archive.find("[Content_Types].xml");
  const root = archive.find("_rels/.rels");
  // Without both, it is no Open XML package: a ZIP of something else.
  if (types === undefined || root === undefined) return "zip";
  // A VBA project refuses the file wherever it sits, declared or not.
  if (archive.entries.some((e) => /vbaproject\.bin$/i.test(e.name))) {
    return "macroWorkbook";
  }
  const [typesBytes, rootBytes] = archive.read([types, root]) as [
    Uint8Array,
    Uint8Array,
  ];
  const typeOf = readContentTypes(typesBytes, budget);
  const rootRelationships = [...readRelationships(rootBytes, budget).values()];
  const documents = rootRelationships.filter(
    (r) => r.type === TYPE.officeDocument,
  );
  if (documents.length === 0) {
    return rootRelationships.some((r) => r.type === TYPE.strictOfficeDocument)
      ? "strictWorkbook"
      : "zip";
  }
  const [document] = documents;
  if (documents.length > 1 || document === undefined) {
    throw new XlsxError("xlsxPackage");
  }
  if (document.external) throw new XlsxError("xlsxExternal");
  const workbookName = resolve("", document.target);
  const workbookEntry =
    workbookName === null ? undefined : archive.find(workbookName);
  if (workbookName === null || workbookEntry === undefined) {
    throw new XlsxError("xlsxPackage");
  }
  const workbookType = typeOf(workbookName);
  if (workbookType === CONTENT.binaryWorkbook) return "binaryWorkbook";
  // A document, a presentation, a template: an Office file, no workbook.
  if (workbookType !== CONTENT.workbook) return "zip";

  const relationshipsEntry = archive.find(relationshipsOf(workbookName));
  if (relationshipsEntry === undefined) throw new XlsxError("xlsxPackage");
  const [workbookBytes, relationshipsBytes] = archive.read([
    workbookEntry,
    relationshipsEntry,
  ]) as [Uint8Array, Uint8Array];
  const relationships = readRelationships(relationshipsBytes, budget);
  const listed = readWorkbookPart(workbookBytes, budget);
  const folder = folderOf(workbookName);

  /** A relationship's part, checked to exist and to be of its type. */
  const partOf = (
    relationship: Relationship,
    content: string,
    sheet: number,
  ): ZipEntry => {
    if (relationship.external) throw new XlsxError("xlsxExternal", sheet);
    const name = resolve(folder, relationship.target);
    const entry = name === null ? undefined : archive.find(name);
    if (name === null || entry === undefined || typeOf(name) !== content) {
      throw new XlsxError("xlsxPackage", sheet);
    }
    return entry;
  };

  const used = new Set<ZipEntry>();
  const sheets: FoundSheet[] = listed.sheets.map((sheet, index) => {
    const position = index + 1;
    const relationship = relationships.get(sheet.id);
    if (relationship === undefined)
      throw new XlsxError("xlsxPackage", position);
    let entry: ZipEntry | null = null;
    if (relationship.type === TYPE.worksheet) {
      entry = partOf(relationship, CONTENT.worksheet, position);
      // Two sheets in one part would be one sheet read twice.
      if (used.has(entry)) throw new XlsxError("xlsxPackage", position);
      used.add(entry);
    } else if (
      relationship.type !== TYPE.chartsheet &&
      relationship.type !== TYPE.dialogsheet
    ) {
      throw new XlsxError("xlsxPackage", position);
    }
    return {
      position,
      name: sheet.name,
      hidden: sheet.hidden,
      worksheet: entry !== null,
      entry,
    };
  });

  const sharedRelationships = [...relationships.values()].filter(
    (r) => r.type === TYPE.sharedStrings,
  );
  if (sharedRelationships.length > 1) throw new XlsxError("xlsxPackage");
  const [shared] = sharedRelationships;
  const sharedEntry =
    shared === undefined ? null : partOf(shared, CONTENT.sharedStrings, 0);
  if (sharedEntry !== null && used.has(sharedEntry)) {
    throw new XlsxError("xlsxPackage");
  }

  return workbook(archive, sheets, listed.date1904, sharedEntry, budget);
}

function workbook(
  archive: ZipArchive,
  sheets: readonly FoundSheet[],
  date1904: boolean,
  sharedEntry: ZipEntry | null,
  budget: Budget,
): Workbook {
  let strings: readonly string[] | null = sharedEntry === null ? [] : null;
  const read = new Map<number, SheetRows>();
  return {
    sheets: sheets.map(({ position, name, hidden, worksheet }) => ({
      position,
      name,
      hidden,
      worksheet,
    })),
    date1904,
    rows(position) {
      const sheet = sheets[position - 1];
      if (sheet === undefined) {
        throw new RangeError("No sheet at that position");
      }
      const done = read.get(position);
      if (done !== undefined) return done;
      if (sheet.entry === null) {
        const none: SheetRows = { rows: [], hiddenCells: false };
        read.set(position, none);
        return none;
      }
      // The shared strings with the first sheet, under one budget check.
      const wanted =
        strings === null && sharedEntry !== null
          ? [sheet.entry, sharedEntry]
          : [sheet.entry];
      let parts: Uint8Array[];
      try {
        parts = archive.read(wanted);
      } catch (error) {
        if (error instanceof ZipError) {
          throw new XlsxError(error.code, position);
        }
        throw error;
      }
      const [sheetBytes, sharedBytes] = parts;
      if (sharedBytes !== undefined) {
        strings = readSharedStrings(sharedBytes, budget);
      }
      const rows = readSheet(
        sheetBytes as Uint8Array,
        position,
        strings ?? [],
        budget,
      );
      read.set(position, rows);
      return rows;
    },
  };
}
