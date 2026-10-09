/**
 * A workbook writer for the tests: the parts of an XLSX file as Excel lays
 * them out, every one open to change, so the reader can be tried on each
 * shape a writer or an attacker might give it.
 */
import { makeZip, type Part } from "./zip-writer.js";

export const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const RELS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export const CONTENT_TYPE = {
  workbook:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  worksheet:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  sharedStrings:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
};

export interface SheetSpec {
  readonly name: string;
  /** What goes inside `<sheetData>`. */
  readonly data?: string;
  /** Elements of the worksheet before and after `<sheetData>`. */
  readonly before?: string;
  readonly after?: string;
  /** `hidden` or `veryHidden`. */
  readonly state?: string;
}

export interface WorkbookSpec {
  readonly sheets: readonly SheetSpec[];
  /** The shared-string table's `<si>` contents, one per string. */
  readonly strings?: readonly string[];
  /** Attributes of `<workbookPr>`. */
  readonly properties?: string;
  /** Changes to the parts, by name, before they are zipped. */
  readonly edit?: (parts: Map<string, string | Uint8Array>) => void;
}

/** Text as XML writes it, the five characters escaped. */
export const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The parts of a workbook, by name, in the order Excel writes them. */
export function workbookParts(
  spec: WorkbookSpec,
): Map<string, string | Uint8Array> {
  const parts = new Map<string, string | Uint8Array>();
  const sheets = spec.sheets.map((_, i) => i + 1);
  const strings = spec.strings !== undefined;
  parts.set(
    "[Content_Types].xml",
    `${DECLARATION}<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE.workbook}"/>${sheets
      .map(
        (n) =>
          `<Override PartName="/xl/worksheets/sheet${String(n)}.xml" ContentType="${CONTENT_TYPE.worksheet}"/>`,
      )
      .join(
        "",
      )}${strings ? `<Override PartName="/xl/sharedStrings.xml" ContentType="${CONTENT_TYPE.sharedStrings}"/>` : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  parts.set(
    "_rels/.rels",
    `${DECLARATION}<Relationships xmlns="${PACKAGE_RELS}"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  parts.set(
    "docProps/core.xml",
    `${DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Writer</dc:creator></cp:coreProperties>`,
  );
  parts.set(
    "xl/workbook.xml",
    `${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${RELS}"><workbookPr ${spec.properties ?? ""}/><bookViews><workbookView/></bookViews><sheets>${spec.sheets
      .map(
        (sheet, i) =>
          `<sheet name="${xml(sheet.name)}" sheetId="${String(i + 1)}"${sheet.state === undefined ? "" : ` state="${sheet.state}"`} r:id="rId${String(i + 1)}"/>`,
      )
      .join("")}</sheets><calcPr calcId="191029"/></workbook>`,
  );
  parts.set(
    "xl/_rels/workbook.xml.rels",
    `${DECLARATION}<Relationships xmlns="${PACKAGE_RELS}">${sheets
      .map(
        (n) =>
          `<Relationship Id="rId${String(n)}" Type="${RELS}/worksheet" Target="worksheets/sheet${String(n)}.xml"/>`,
      )
      .join(
        "",
      )}${strings ? `<Relationship Id="rId${String(sheets.length + 1)}" Type="${RELS}/sharedStrings" Target="sharedStrings.xml"/>` : ""}</Relationships>`,
  );
  spec.sheets.forEach((sheet, i) => {
    parts.set(
      `xl/worksheets/sheet${String(i + 1)}.xml`,
      `${DECLARATION}<worksheet xmlns="${MAIN}" xmlns:r="${RELS}">${sheet.before ?? ""}<sheetData>${sheet.data ?? ""}</sheetData>${sheet.after ?? ""}</worksheet>`,
    );
  });
  if (spec.strings !== undefined) {
    parts.set(
      "xl/sharedStrings.xml",
      `${DECLARATION}<sst xmlns="${MAIN}" count="${String(spec.strings.length)}" uniqueCount="${String(spec.strings.length)}">${spec.strings
        .map((s) => `<si>${s}</si>`)
        .join("")}</sst>`,
    );
  }
  spec.edit?.(parts);
  return parts;
}

/** A workbook's bytes, its parts zipped as Excel zips them. */
export function makeWorkbook(
  spec: WorkbookSpec,
  zip: (parts: Part[]) => Uint8Array = (p) => makeZip(p),
): Uint8Array {
  const encoder = new TextEncoder();
  return zip(
    [...workbookParts(spec)].map(([name, content]) => ({
      name,
      content: typeof content === "string" ? encoder.encode(content) : content,
    })),
  );
}
