/**
 * A bounded CSV reader for broker exports. Every imported file is hostile
 * (CLAUDE.md, "Secure code"), so it reads in one linear pass without regular
 * expressions, caps the size of everything, and refuses rather than repairs:
 * a stray quote, a row with too few or too many cells, or a repeated header
 * name stops the import instead of shifting a value into the wrong column.
 *
 * RFC 4180, plus what broker exports add: an optional byte-order mark, LF or
 * CRLF line ends, and empty lines, which carry no data and are skipped.
 * Errors name a rule and a row number, never a value from the file.
 */

export interface CsvLimits {
  /** Characters of text, checked before anything is read. */
  readonly maxLength: number;
  /** Data rows, the header not counted. */
  readonly maxRows: number;
  readonly maxColumns: number;
  /** Characters in one cell. */
  readonly maxCellLength: number;
}

/**
 * Far above any real export: a year of Trading 212 history is a few
 * thousand rows of under 300 characters, and its widest header has about 40
 * columns.
 */
export const CSV_LIMITS: CsvLimits = Object.freeze({
  maxLength: 32 * 1024 * 1024,
  maxRows: 200_000,
  maxColumns: 100,
  maxCellLength: 4096,
});

export type CsvErrorCode =
  | "tooLarge"
  | "tooManyRows"
  | "tooManyColumns"
  | "cellTooLong"
  | "unterminatedQuote"
  | "strayQuote"
  | "strayCarriageReturn"
  | "noHeader"
  | "emptyHeaderName"
  | "duplicateHeaderName"
  | "rowLength";

export class CsvError extends Error {
  constructor(
    readonly code: CsvErrorCode,
    /** The row as a spreadsheet numbers it (the header is row 1); 0 for the file. */
    readonly row: number,
  ) {
    super(`CSV ${code} at row ${String(row)}`);
    this.name = "CsvError";
  }
}

export interface CsvRow {
  /** As a spreadsheet numbers it, empty lines included: the header is row 1. */
  readonly row: number;
  readonly cells: readonly string[];
}

export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly CsvRow[];
  /**
   * The index of a column by its exact header name. A Map behind it, so no
   * header name (`__proto__`, `constructor`) can reach an object prototype.
   */
  column(name: string): number | undefined;
}

const QUOTE = 0x22;
const COMMA = 0x2c;
const LF = 0x0a;
const CR = 0x0d;
const BOM = 0xfeff;

/** Reads `text` as CSV with a header row; see the module comment for the rules. */
export function readCsv(
  text: string,
  limits: CsvLimits = CSV_LIMITS,
): CsvTable {
  if (text.length > limits.maxLength) throw new CsvError("tooLarge", 0);
  const end = text.length;
  let pos = text.charCodeAt(0) === BOM ? 1 : 0;
  let row = 0;
  let header: string[] | undefined;
  let headerRow = 0;
  const rows: CsvRow[] = [];

  /** True at a line end: LF, or CR followed by LF. */
  const lineEnd = (at: number) => {
    const c = text.charCodeAt(at);
    return c === LF || (c === CR && text.charCodeAt(at + 1) === LF);
  };
  const skipLineEnd = () => {
    pos += text.charCodeAt(pos) === CR ? 2 : 1;
  };

  while (pos < end) {
    row += 1;
    if (lineEnd(pos)) {
      skipLineEnd();
      continue;
    }
    const cells: string[] = [];
    for (;;) {
      if (cells.length === limits.maxColumns) {
        throw new CsvError("tooManyColumns", row);
      }
      let cell: string;
      if (text.charCodeAt(pos) === QUOTE) {
        // Quoted: "" stands for a quote, and everything else is literal,
        // line breaks and commas included.
        pos += 1;
        const parts: string[] = [];
        let length = 0;
        for (;;) {
          const close = text.indexOf('"', pos);
          if (close === -1) throw new CsvError("unterminatedQuote", row);
          length += close - pos;
          if (length > limits.maxCellLength) {
            throw new CsvError("cellTooLong", row);
          }
          parts.push(text.slice(pos, close));
          pos = close + 1;
          if (text.charCodeAt(pos) !== QUOTE) break;
          parts.push('"');
          length += 1;
          pos += 1;
        }
        cell = parts.join("");
        // After the closing quote: a comma, a line end or the end of text.
        if (pos < end && text.charCodeAt(pos) !== COMMA && !lineEnd(pos)) {
          throw new CsvError("strayQuote", row);
        }
      } else {
        // Unquoted: up to the next comma or line end. A quote inside is not
        // RFC 4180, and a lone CR is no line end: both are refused.
        let at = pos;
        while (at < end) {
          const c = text.charCodeAt(at);
          if (c === COMMA || c === LF) break;
          if (c === CR) {
            if (text.charCodeAt(at + 1) === LF) break;
            throw new CsvError("strayCarriageReturn", row);
          }
          if (c === QUOTE) throw new CsvError("strayQuote", row);
          at += 1;
          if (at - pos > limits.maxCellLength) {
            throw new CsvError("cellTooLong", row);
          }
        }
        cell = text.slice(pos, at);
        pos = at;
      }
      cells.push(cell);
      if (pos < end && text.charCodeAt(pos) === COMMA) {
        pos += 1;
        continue;
      }
      if (pos < end) skipLineEnd();
      break;
    }

    if (header === undefined) {
      header = cells;
      headerRow = row;
      continue;
    }
    if (cells.length !== header.length) throw new CsvError("rowLength", row);
    if (rows.length === limits.maxRows) throw new CsvError("tooManyRows", row);
    rows.push({ row, cells });
  }

  if (header === undefined) throw new CsvError("noHeader", 0);
  const columns = new Map<string, number>();
  for (const [index, name] of header.entries()) {
    if (name === "") throw new CsvError("emptyHeaderName", headerRow);
    if (columns.has(name)) {
      throw new CsvError("duplicateHeaderName", headerRow);
    }
    columns.set(name, index);
  }
  return {
    header,
    rows,
    column: (name) => columns.get(name),
  };
}
