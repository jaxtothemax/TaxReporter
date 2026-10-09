/**
 * The workbook reader on workbooks a small writer here makes: what Excel
 * writes reads as typed cells, each package or cell rule refuses the file
 * that breaks it with its place, and nothing is inflated or told before it
 * is needed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LIMITS } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import {
  CONTENT_TYPE,
  MAIN,
  makeWorkbook,
  RELS,
  type WorkbookSpec,
} from "./testing/workbook.js";
import { makeZip } from "./testing/zip-writer.js";
import {
  openWorkbook,
  XlsxError,
  type Cell,
  type Workbook,
  type WorkbookReason,
} from "./xlsx.js";

const one = (data: string, spec: Partial<WorkbookSpec> = {}): WorkbookSpec => ({
  sheets: [{ name: "Trades", data }],
  ...spec,
});

function open(spec: WorkbookSpec): Workbook {
  const book = openWorkbook(makeWorkbook(spec));
  if (typeof book === "string") throw new Error(`refused: ${book}`);
  return book;
}

/** The cells of a sheet as "A1=number:1.5" lines. */
function cells(book: Workbook, position = 1): string[] {
  const show = (cell: Cell) =>
    cell.kind === "number"
      ? `number:${cell.value}`
      : cell.kind === "boolean"
        ? `boolean:${String(cell.value)}`
        : `${cell.kind}:${cell.text}`;
  return book
    .rows(position)
    .rows.flatMap(({ row, cells }) =>
      [...cells].map(
        ([column, cell]) =>
          `${String.fromCharCode(0x40 + column)}${String(row)}=${show(cell)}`,
      ),
    );
}

/** Where a workbook is refused: [code, sheet, row, column], or "none". */
function refusal(
  spec: WorkbookSpec,
  read: (book: Workbook) => unknown = (book) => book.rows(1),
): [WorkbookReason, number, number, number] | string {
  try {
    const book = openWorkbook(makeWorkbook(spec));
    if (typeof book === "string") return book;
    read(book);
    return "none";
  } catch (error) {
    if (!(error instanceof XlsxError)) throw error;
    return [error.code, error.sheet, error.row, error.column];
  }
}

const code = (spec: WorkbookSpec, read?: (book: Workbook) => unknown) => {
  const result = refusal(spec, read);
  return typeof result === "string" ? result : result[0];
};

/** Edits one part's text. */
const editing =
  (name: string, change: (text: string) => string) =>
  (parts: Map<string, string | Uint8Array>) => {
    const text = parts.get(name);
    if (typeof text !== "string") throw new Error(`no part ${name}`);
    parts.set(name, change(text));
  };

describe("openWorkbook: what it reads", () => {
  it("lists the sheets, their names as written, and the date system", () => {
    const book = open({
      sheets: [
        { name: "Closed Positions" },
        { name: "PENDING ORDERS HISTORY " },
        { name: "Hidden", state: "hidden" },
        { name: "Very", state: "veryHidden" },
      ],
      properties: 'date1904="1"',
    });
    expect(book.sheets).toEqual([
      { position: 1, name: "Closed Positions", hidden: false, worksheet: true },
      {
        position: 2,
        name: "PENDING ORDERS HISTORY ",
        hidden: false,
        worksheet: true,
      },
      { position: 3, name: "Hidden", hidden: true, worksheet: true },
      { position: 4, name: "Very", hidden: true, worksheet: true },
    ]);
    expect(book.date1904).toBe(true);
    for (const properties of ['date1904="true"', 'date1904="0"', ""]) {
      expect(open(one("", { properties })).date1904).toBe(
        properties === 'date1904="true"',
      );
    }
  });

  it("reads typed cells, each with its stored text, sparsely", () => {
    const book = open(
      one(
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>` +
          `<row r="3"><c r="A3"><v>2.6315789999999998</v></c><c r="B3" t="b"><v>1</v></c><c r="C3" t="e"><v>#N/A</v></c><c r="D3" s="4"/></row>` +
          `<row r="4"><c r="A4" t="inlineStr"><is><t xml:space="preserve"> Apple </t></is></c><c r="B4" t="str"><v>x &amp; y</v></c></row>`,
        {
          strings: [
            "<t>Date</t>",
            '<r><rPr><b/></rPr><t>Am</t></r><r><t>ount</t></r><rPh sb="0" eb="1"><t>PHONETIC</t></rPh>',
          ],
        },
      ),
    );
    expect(cells(book)).toEqual([
      "A1=string:Date",
      "C1=string:Amount",
      "A3=number:2.631579",
      "B3=boolean:true",
      "C3=error:#N/A",
      "A4=string: Apple ",
      "B4=string:x & y",
    ]);
    const [number] = book.rows(1).rows[1]?.cells.values() ?? [];
    expect(number).toEqual({
      kind: "number",
      text: "2.6315789999999998",
      value: "2.631579",
    });
  });

  it("places a row or cell without a reference where Excel places it", () => {
    const book = open(
      one(
        `<row><c><v>1</v></c><c><v>2</v></c><c r="E1"><v>5</v></c><c><v>6</v></c></row><row><c><v>7</v></c></row>`,
      ),
    );
    expect(cells(book)).toEqual([
      "A1=number:1",
      "B1=number:2",
      "E1=number:5",
      "F1=number:6",
      "A2=number:7",
    ]);
  });

  it("decodes a string's escapes as Excel shows them", () => {
    const book = open(
      one(
        `<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row>`,
        {
          strings: [
            "<t>_x0041_BC</t>",
            "<t>_x005F_x0041_</t>",
            "<t>a_x000D_b</t>",
          ],
        },
      ),
    );
    expect(cells(book)).toEqual([
      "A1=string:ABC",
      "B1=string:_x0041_",
      "C1=string:a\rb",
    ]);
  });

  it("reads what Excel writes besides the cells, and skips it", () => {
    const book = open({
      sheets: [
        {
          name: "Trades",
          before:
            '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:B2"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"/><cols><col min="1" max="1" width="9"/></cols>',
          data: '<row r="1" spans="1:2" x14ac:dyDescent="0.25" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"><c r="A1"><v>1</v></c></row>',
          after:
            '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><headerFooter><oddHeader>&amp;C&amp;P</oddHeader></headerFooter><conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>A1&gt;0</formula></cfRule></conditionalFormatting><extLst><ext uri="{X}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings/></ext></extLst>',
        },
      ],
      edit: editing("xl/workbook.xml", (text) =>
        text.replace(
          "</sheets>",
          '</sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Trades!$A$1:$B$2</definedName></definedNames><extLst><ext uri="{Y}"><x15ac:absPath url="C:\\Users\\Someone\\" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></ext></extLst>',
        ),
      ),
    });
    expect(cells(book)).toEqual(["A1=number:1"]);
    expect(book.rows(1).hiddenCells).toBe(false);
  });

  it("says when a row or column of a sheet is hidden", () => {
    const hiddenRow = open(one('<row r="1" hidden="1"><c><v>1</v></c></row>'));
    expect(hiddenRow.rows(1).hiddenCells).toBe(true);
    const hiddenColumn = open({
      sheets: [
        {
          name: "Trades",
          before: '<cols><col min="2" max="2" hidden="true"/></cols>',
          data: "<row><c><v>1</v></c></row>",
        },
      ],
    });
    expect(hiddenColumn.rows(1).hiddenCells).toBe(true);
  });

  it("reads parts with a byte-order mark, stored, or with data descriptors", () => {
    const bom = String.fromCharCode(0xfeff);
    const spec = one("<row><c><v>1</v></c></row>", {
      edit: editing("xl/worksheets/sheet1.xml", (text) => bom + text),
    });
    expect(cells(open(spec))).toEqual(["A1=number:1"]);
    for (const shape of [
      { method: 0 as const },
      { descriptor: "signed" as const },
      { descriptor: "unsigned" as const },
    ]) {
      const bytes = makeWorkbook(spec, (parts) =>
        makeZip(parts.map((part) => ({ ...part, ...shape }))),
      );
      const book = openWorkbook(bytes);
      if (typeof book === "string") throw new Error(book);
      expect(cells(book)).toEqual(["A1=number:1"]);
    }
  });

  it("finds parts whatever the case of their names, and by absolute targets", () => {
    const spec: WorkbookSpec = {
      ...one("<row><c><v>1</v></c></row>"),
      edit: editing("xl/_rels/workbook.xml.rels", (text) =>
        text.replace(
          'Target="worksheets/sheet1.xml"',
          'Target="/XL/Worksheets/./Sheet1.xml"',
        ),
      ),
    };
    expect(cells(open(spec))).toEqual(["A1=number:1"]);
  });

  it("lists a chart sheet, which has no rows", () => {
    const book = open({
      sheets: [{ name: "Trades" }, { name: "Chart" }],
      edit: editing("xl/_rels/workbook.xml.rels", (text) =>
        text.replace(
          `Type="${RELS}/worksheet" Target="worksheets/sheet2.xml"`,
          `Type="${RELS}/chartsheet" Target="chartsheets/sheet1.xml"`,
        ),
      ),
    });
    expect(book.sheets[1]?.worksheet).toBe(false);
    expect(book.rows(2).rows).toEqual([]);
  });
});

describe("openWorkbook: files refused for what they are", () => {
  const spec = one("<row><c><v>1</v></c></row>");

  it("refuses a ZIP of anything else", () => {
    const zip = makeZip([{ name: "a.txt", content: new Uint8Array([65]) }]);
    expect(openWorkbook(zip)).toBe("zip");
    // An Office document, but no workbook.
    const document = {
      ...spec,
      edit: editing("[Content_Types].xml", (text) =>
        text.replace(
          CONTENT_TYPE.workbook,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ),
      ),
    };
    expect(code(document)).toBe("zip");
  });

  it("refuses a binary, a macro-enabled and a Strict workbook", () => {
    expect(
      code({
        ...spec,
        edit: editing("[Content_Types].xml", (text) =>
          text.replace(
            CONTENT_TYPE.workbook,
            "application/vnd.ms-excel.sheet.binary.macroEnabled.main",
          ),
        ),
      }),
    ).toBe("binaryWorkbook");
    expect(
      code({
        ...spec,
        edit: editing("[Content_Types].xml", (text) =>
          text.replace(
            CONTENT_TYPE.workbook,
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
          ),
        ),
      }),
    ).toBe("macroWorkbook");
    expect(
      code({
        ...spec,
        edit: editing("_rels/.rels", (text) =>
          text.replace(
            `${RELS}/officeDocument`,
            "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
          ),
        ),
      }),
    ).toBe("strictWorkbook");
  });

  it("refuses a VBA project or a macro sheet wherever it sits", () => {
    expect(
      code({
        ...spec,
        edit: (parts) => parts.set("xl/vbaProject.bin", new Uint8Array([1])),
      }),
    ).toBe("macroWorkbook");
    expect(
      code({
        ...spec,
        edit: editing("xl/_rels/workbook.xml.rels", (text) =>
          text.replace(
            "</Relationships>",
            '<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet" Target="macrosheets/sheet1.xml"/></Relationships>',
          ),
        ),
      }),
    ).toBe("macroWorkbook");
  });
});

describe("openWorkbook: one refusal per rule, with its place", () => {
  it("refuses a package OPC would not take", () => {
    const cases: [string, WorkbookSpec][] = [
      [
        "two office documents",
        one("", {
          edit: editing("_rels/.rels", (text) =>
            text.replace(
              "</Relationships>",
              `<Relationship Id="rId9" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
            ),
          ),
        }),
      ],
      [
        "no workbook part",
        one("", { edit: (parts) => parts.delete("xl/workbook.xml") }),
      ],
      [
        "no workbook relationships",
        one("", {
          edit: (parts) => parts.delete("xl/_rels/workbook.xml.rels"),
        }),
      ],
      [
        "a sheet without its relationship",
        one("", {
          edit: editing("xl/workbook.xml", (text) =>
            text.replace('r:id="rId1"', 'r:id="rId7"'),
          ),
        }),
      ],
      [
        "a target outside the package",
        one("", {
          edit: editing("xl/_rels/workbook.xml.rels", (text) =>
            // Above the root, then back to a real part: never clamped.
            text.replace(
              "worksheets/sheet1.xml",
              "../../xl/worksheets/sheet1.xml",
            ),
          ),
        }),
      ],
      [
        "a percent-encoded target",
        one("", {
          edit: editing("xl/_rels/workbook.xml.rels", (text) =>
            text.replace("worksheets/sheet1.xml", "worksheets/sheet%31.xml"),
          ),
        }),
      ],
      [
        "a sheet part of another type",
        one("", {
          edit: editing("[Content_Types].xml", (text) =>
            text.replace(CONTENT_TYPE.worksheet, "application/xml"),
          ),
        }),
      ],
      [
        "a sheet relationship of another type",
        one("", {
          edit: editing("xl/_rels/workbook.xml.rels", (text) =>
            text.replace(`${RELS}/worksheet`, `${RELS}/pivotTable`),
          ),
        }),
      ],
      [
        "two shared-string tables",
        one("", {
          strings: ["<t>a</t>"],
          edit: editing("xl/_rels/workbook.xml.rels", (text) =>
            text.replace(
              "</Relationships>",
              `<Relationship Id="rId8" Type="${RELS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
            ),
          ),
        }),
      ],
      [
        "a content type given twice by extension",
        one("", {
          edit: editing("[Content_Types].xml", (text) =>
            text.replace(
              '<Default Extension="xml"',
              '<Default Extension="XML" ContentType="application/xml"/><Default Extension="xml"',
            ),
          ),
        }),
      ],
      [
        "a content type given twice by part",
        one("", {
          edit: editing("[Content_Types].xml", (text) =>
            text.replace(
              "</Types>",
              `<Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE.workbook}"/></Types>`,
            ),
          ),
        }),
      ],
      [
        "two relationships with one ID",
        one("", {
          edit: editing("xl/_rels/workbook.xml.rels", (text) =>
            text.replace(
              "</Relationships>",
              `<Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
            ),
          ),
        }),
      ],
    ];
    for (const [label, spec] of cases)
      expect(code(spec), label).toBe("xlsxPackage");
    // Two sheets in one part.
    expect(
      refusal({
        sheets: [{ name: "A" }, { name: "B" }],
        edit: editing("xl/_rels/workbook.xml.rels", (text) =>
          text.replace("worksheets/sheet2.xml", "worksheets/sheet1.xml"),
        ),
      }),
    ).toEqual(["xlsxPackage", 2, 0, 0]);
  });

  it("never follows a sheet kept outside the file", () => {
    expect(
      refusal(
        one("", {
          edit: editing("xl/_rels/workbook.xml.rels", (text) =>
            text.replace(
              'Target="worksheets/sheet1.xml"',
              'Target="https://example.com/sheet.xml" TargetMode="External"',
            ),
          ),
        }),
      ),
    ).toEqual(["xlsxExternal", 1, 0, 0]);
  });

  it("refuses a malformed list of sheets or date system", () => {
    expect(code(one("", { properties: 'date1904="yes"' }))).toBe(
      "xlsxWorkbook",
    );
    // A second date system or sheet list: first and last would disagree.
    expect(
      code(
        one("", {
          edit: editing("xl/workbook.xml", (t) =>
            t.replace("<bookViews>", '<workbookPr date1904="1"/><bookViews>'),
          ),
        }),
      ),
    ).toBe("xlsxWorkbook");
    expect(
      code(
        one("", {
          edit: editing("xl/workbook.xml", (t) =>
            t.replace("<calcPr", "<sheets/><calcPr"),
          ),
        }),
      ),
    ).toBe("xlsxWorkbook");
    const sheetList = (change: (text: string) => string) =>
      code(one("", { edit: editing("xl/workbook.xml", change) }));
    expect(sheetList((t) => t.replace(' name="Trades"', ""))).toBe(
      "xlsxWorkbook",
    );
    expect(sheetList((t) => t.replace('sheetId="1"', 'sheetId="01"'))).toBe(
      "xlsxWorkbook",
    );
    expect(
      sheetList((t) => t.replace('r:id="rId1"', 'state="shy" r:id="rId1"')),
    ).toBe("xlsxWorkbook");
    expect(
      sheetList((t) =>
        t.replace(
          "<sheets>",
          '<sheets><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"/>',
        ),
      ),
    ).toBe("xlsxWorkbook");
    expect(
      code({
        sheets: [{ name: "A" }, { name: "B" }],
        edit: editing("xl/workbook.xml", (t) =>
          t.replace('sheetId="2"', 'sheetId="1"'),
        ),
      }),
    ).toBe("xlsxWorkbook");
  });

  it("holds the sheet limits at their value, and refuses one past them", () => {
    const sheets = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `S${String(i)}` }));
    expect(code({ sheets: sheets(LIMITS.sheetsPerFile) })).toBe("none");
    expect(code({ sheets: sheets(LIMITS.sheetsPerFile + 1) })).toBe(
      "xlsxSheets",
    );
    expect(code({ sheets: [{ name: "x".repeat(31) }] })).toBe("none");
    expect(refusal({ sheets: [{ name: "x".repeat(32) }] })).toEqual([
      "xlsxSheetName",
      1,
      0,
      0,
    ]);
    expect(code({ sheets: [{ name: "" }] })).toBe("xlsxSheetName");
    expect(
      refusal({ sheets: [{ name: "Trades" }, { name: "TRADES" }] }),
    ).toEqual(["xlsxSheetName", 2, 0, 0]);
  });

  it("refuses an element or text where a sheet holds none", () => {
    const cases = [
      '<row><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice/></mc:AlternateContent></row>',
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"/>',
      "<row><c><v>1</v><extLst/></c></row>",
      "<row><x/></row>",
      "<col/>",
      "<row><c>1</c></row>",
      "<row>text</row>",
      "text",
    ];
    for (const data of cases)
      expect(code(one(data)), data).toBe("xlsxStructure");
  });

  it("refuses a reference malformed, out of order or past Excel's grid", () => {
    const cases: [string, number, number][] = [
      // Out of order, repeated, outside its row: at the cell as written.
      ['<row r="1"><c r="B1"><v>1</v></c><c r="A1"><v>1</v></c></row>', 1, 1],
      ['<row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>1</v></c></row>', 1, 1],
      ['<row r="1"><c r="A2"><v>1</v></c></row>', 1, 1],
      ['<row r="2"/><row r="1"/>', 1, 0],
      ['<row r="3"/><row r="3"/>', 3, 0],
      // Malformed, or past Excel's grid: no place in the sheet.
      ['<row r="1"><c r="a1"><v>1</v></c></row>', 1, 0],
      ['<row r="1"><c r="A01"><v>1</v></c></row>', 1, 0],
      ['<row r="1"><c r="AAAA1"><v>1</v></c></row>', 1, 0],
      ['<row r="1"><c r="XFE1"><v>1</v></c></row>', 1, 0],
      ['<row r="01"/>', 0, 0],
      ['<row r="1048577"/>', 0, 0],
    ];
    for (const [data, row, column] of cases) {
      expect(refusal(one(data)), data).toEqual([
        "xlsxReference",
        1,
        row,
        column,
      ]);
    }
    expect(code(one('<row r="1048576"/>'))).toBe("none");
  });

  it("holds the column limit at its value, and refuses one past it", () => {
    const at = (column: number) =>
      one(`<row><c r="${columnName(column)}1"><v>1</v></c></row>`);
    expect(code(at(LIMITS.columns))).toBe("none");
    expect(refusal(at(LIMITS.columns + 1))).toEqual([
      "xlsxColumns",
      1,
      1,
      LIMITS.columns + 1,
    ]);
  });

  it("refuses a shared-string index not canonical or out of range", () => {
    const strings = ["<t>a</t>"];
    expect(code(one('<row><c t="s"><v>0</v></c></row>', { strings }))).toBe(
      "none",
    );
    expect(code(one('<row><c t="s"><v>1</v></c></row>', { strings }))).toBe(
      "xlsxSharedStrings",
    );
    expect(code(one('<row><c t="s"><v>00</v></c></row>', { strings }))).toBe(
      "xlsxSharedStrings",
    );
    expect(code(one('<row><c t="s"><v>0</v></c></row>'))).toBe(
      "xlsxSharedStrings",
    );
  });

  it("refuses a shared-string table holding what no string is made of", () => {
    for (const si of [
      "<x/>",
      "text",
      "<r><x/></r>",
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"/>',
    ]) {
      expect(code(one("", { strings: [si] })), si).toBe("xlsxStructure");
    }
  });

  it("refuses a string too long, or an escape that names no character", () => {
    const long = (n: number) =>
      one('<row><c t="s"><v>0</v></c></row>', {
        strings: [`<t>${"x".repeat(n)}</t>`],
      });
    expect(code(long(LIMITS.xlsxCellLength))).toBe("none");
    // One piece past it, the scanner refuses; runs joined past it, the reader.
    expect(code(long(LIMITS.xlsxCellLength + 1))).toBe("valueTooLong");
    const half = "x".repeat(Math.ceil((LIMITS.xlsxCellLength + 1) / 2));
    expect(
      code(
        one('<row><c t="s"><v>0</v></c></row>', {
          strings: [`<r><t>${half}</t></r><r><t>${half}</t></r>`],
        }),
      ),
    ).toBe("xlsxText");
    for (const text of ["_xD800_", "_x0001_"]) {
      expect(
        code(
          one('<row><c t="s"><v>0</v></c></row>', {
            strings: [`<t>${text}</t>`],
          }),
        ),
        text,
      ).toBe("xlsxText");
      expect(
        refusal(one(`<row><c r="B1" t="str"><v>${text}</v></c></row>`)),
        text,
      ).toEqual(["xlsxText", 1, 1, 2]);
    }
  });

  it("refuses a kind of cell it does not read", () => {
    const cases = [
      '<c t="d"><v>2025-10-23T00:00:00</v></c>',
      '<c t="x"><v>1</v></c>',
      '<c cm="1"><v>1</v></c>',
      '<c vm="1"><v>1</v></c>',
      '<c t="b"><v>2</v></c>',
      '<c t="e"><v>#WHAT?</v></c>',
      '<c t="s"><is><t>a</t></is></c>',
      '<c t="inlineStr"><v>a</v></c>',
    ];
    for (const cell of cases) {
      expect(refusal(one(`<row>${cell}</row>`)), cell).toEqual([
        "xlsxCellType",
        1,
        1,
        1,
      ]);
    }
  });

  it("refuses a number that is none, and any formula", () => {
    expect(refusal(one("<row><c><v>abc</v></c></row>"))).toEqual([
      "xlsxNumber",
      1,
      1,
      1,
    ]);
    expect(code(one("<row><c><v>1e99</v></c></row>"))).toBe("xlsxNumber");
    for (const formula of [
      "<f>SUM(B1:B2)</f><v>3</v>",
      '<f t="shared" si="0"/><v>3</v>',
    ]) {
      expect(
        refusal(
          one(
            `<row><c r="C2">${formula}</c></row>`.replace(
              "<row>",
              '<row r="2">',
            ),
          ),
        ),
      ).toEqual(["xlsxFormula", 1, 2, 3]);
    }
  });

  it("refuses a part that is not UTF-8, or XML it refuses, at the sheet's position", () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00]);
    expect(
      refusal(
        {
          sheets: [{ name: "A" }, { name: "B" }],
          edit: (parts) => parts.set("xl/worksheets/sheet2.xml", utf16),
        },
        (book) => book.rows(2),
      ),
    ).toEqual(["xlsxEncoding", 2, 0, 0]);
    expect(
      refusal(
        one("", {
          edit: editing("xl/worksheets/sheet1.xml", (t) =>
            t.replace(
              "<worksheet",
              '<!DOCTYPE worksheet [<!ENTITY x "y">]><worksheet',
            ),
          ),
        }),
      ),
    ).toEqual(["doctype", 1, 0, 0]);
  });

  it("refuses a damaged archive with the ZIP reader's reason", () => {
    const bytes = makeWorkbook(one(""));
    expect(() => openWorkbook(bytes.subarray(0, bytes.length - 1))).toThrow(
      XlsxError,
    );
    try {
      openWorkbook(bytes.subarray(0, bytes.length - 1));
    } catch (error) {
      expect((error as XlsxError).code).toBe("zipEnd");
    }
  });
});

describe("openWorkbook: what Excel and TaxReporter could read differently", () => {
  const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";

  it("keeps white space that is text: a run of one space, a blank string", () => {
    const book = open(
      one(
        '<row><c t="s"><v>0</v></c><c t="inlineStr"><is><t xml:space="preserve">   </t></is></c><c t="inlineStr"><is><t>a<!--x--> <!--y-->b</t></is></c></row>',
        {
          strings: [
            '<r><t>Buy</t></r><r><t xml:space="preserve"> </t></r><r><t>AAPL</t></r>',
          ],
        },
      ),
    );
    expect(cells(book)).toEqual([
      "A1=string:Buy AAPL",
      "B1=string:   ",
      "C1=string:a b",
    ]);
  });

  it("decodes each piece of text on its own, as Excel does", () => {
    const book = open(
      one('<row><c t="s"><v>0</v></c></row>', {
        strings: ["<r><t>_x00</t></r><r><t>41_</t></r>"],
      }),
    );
    expect(cells(book)).toEqual(["A1=string:_x0041_"]);
  });

  it("refuses a string built in a way Excel does not build one", () => {
    for (const si of [
      "<t>a<t>b</t></t>",
      "<t>a</t><t>b</t>",
      "<t>a</t><r><t>b</t></r>",
      "<r><t>a</t><t>b</t></r>",
      "<r><t>a</t></r><t>b</t>",
    ]) {
      expect(code(one("", { strings: [si] })), si).toBe("xlsxStructure");
    }
    expect(
      code(one('<row><c t="inlineStr"><is><t>a</t></is><v>1</v></c></row>')),
    ).toBe("xlsxCellType");
    expect(code(one("<row><c><v>1<x/></v></c></row>"))).toBe("xlsxStructure");
  });

  it("holds a value to Excel's limit on a cell at its value, however split", () => {
    const value = (n: number) => {
      const half = Math.floor(n / 2);
      return one(
        `<row><c t="str"><v>${"x".repeat(half)}<!-- -->${"x".repeat(n - half)}</v></c></row>`,
      );
    };
    expect(code(value(LIMITS.xlsxCellLength))).toBe("none");
    expect(code(value(LIMITS.xlsxCellLength + 1))).toBe("xlsxText");
  });

  it("holds an inline string and a value to Excel's limit on a cell", () => {
    const half = "x".repeat(Math.ceil((LIMITS.xlsxCellLength + 1) / 2));
    expect(
      code(
        one(
          `<row><c t="inlineStr"><is><r><t>${half}</t></r><r><t>${half}</t></r></is></c></row>`,
        ),
      ),
    ).toBe("xlsxText");
    expect(
      code(one(`<row><c t="str"><v>${half}<!-- -->${half}</v></c></row>`)),
    ).toBe("xlsxText");
  });

  it("refuses what Markup Compatibility would put in the place of a part's own content", () => {
    const choice = (inner: string) =>
      `<mc:AlternateContent xmlns:mc="${MC_NS}"><mc:Choice Requires="x15">${inner}</mc:Choice><mc:Fallback/></mc:AlternateContent>`;
    expect(
      code(
        one("", {
          edit: editing("xl/workbook.xml", (text) =>
            text
              .replace("<workbookPr />", "")
              .replace(
                "<bookViews>",
                `${choice('<workbookPr date1904="1"/>')}<bookViews>`,
              ),
          ),
        }),
      ),
    ).toBe("xlsxWorkbook");
    expect(
      code({
        sheets: [
          {
            name: "A",
            data: "<row><c><v>1</v></c></row>",
            after: choice("<sheetData><row><c><v>2</v></c></row></sheetData>"),
          },
        ],
      }),
    ).toBe("xlsxStructure");
    // Excel's own extensions there still pass.
    expect(
      code(
        one("<row><c><v>1</v></c></row>", {
          edit: editing("xl/workbook.xml", (text) =>
            text.replace(
              "</sheets>",
              `</sheets>${choice('<x15ac:absPath url="C:\\x\\" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/>')}`,
            ),
          ),
        }),
      ),
    ).toBe("none");
  });

  it("reads the rows once, whatever Markup Compatibility follows sheetData", () => {
    const book = open({
      sheets: [
        {
          name: "A",
          data: "<row><c><v>1</v></c></row><row><c><v>2</v></c></row>",
          after: `<mc:AlternateContent xmlns:mc="${MC_NS}"><mc:Choice Requires="y" xmlns:y="urn:y"><y:z/></mc:Choice><mc:Fallback/></mc:AlternateContent>`,
        },
      ],
    });
    expect(book.rows(1).rows.map((r) => r.row)).toEqual([1, 2]);
  });

  it("reads exactly one sheetData", () => {
    const sheet = (xml: string) => ({
      sheets: [{ name: "A" }],
      edit: editing("xl/worksheets/sheet1.xml", () => xml),
    });
    expect(code(sheet(`<worksheet xmlns="${MAIN}"/>`))).toBe("xlsxStructure");
    expect(
      code(
        sheet(
          `<worksheet xmlns="${MAIN}"><sheetData/><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>`,
        ),
      ),
    ).toBe("xlsxStructure");
  });

  it("matches content types by ASCII case alone", () => {
    // U+212A KELVIN SIGN folds to "k" in Unicode, never in a MIME type.
    const kelvin = String.fromCharCode(0x212a);
    const spec = one("<row><c><v>1</v></c></row>", {
      edit: editing("[Content_Types].xml", (text) =>
        text.replace(
          CONTENT_TYPE.worksheet,
          CONTENT_TYPE.worksheet.replace("k", kelvin),
        ),
      ),
    });
    expect(code(spec)).toBe("xlsxPackage");
  });

  it("says a sheet hides cells by a row or column of no size, or hidden by default", () => {
    const hides = (spec: WorkbookSpec) => open(spec).rows(1).hiddenCells;
    expect(
      hides(one('<row r="1" ht="0" customHeight="1"><c><v>1</v></c></row>')),
    ).toBe(true);
    expect(
      hides({
        sheets: [
          {
            name: "A",
            before: '<cols><col min="1" max="1" width="0"/></cols>',
            data: "<row><c><v>1</v></c></row>",
          },
        ],
      }),
    ).toBe(true);
    expect(
      hides({
        sheets: [
          {
            name: "A",
            before: '<sheetFormatPr defaultRowHeight="15" zeroHeight="1"/>',
            data: "<row><c><v>1</v></c></row>",
          },
        ],
      }),
    ).toBe(true);
    expect(hides(one('<row r="1" ht="15"><c><v>1</v></c></row>'))).toBe(false);
  });
});

describe("openWorkbook: nothing before it is needed", () => {
  it("inflates a sheet only when its rows are asked for", () => {
    // A sheet whose part fails its checksum opens, and refuses when read.
    const bytes = makeWorkbook(
      {
        sheets: [
          { name: "A" },
          { name: "B", data: "<row><c><v>1</v></c></row>" },
        ],
      },
      (parts) =>
        makeZip(parts, {
          central: (index, header) => {
            if (parts[index]?.name === "xl/worksheets/sheet2.xml") {
              header.setUint32(
                16,
                (header.getUint32(16, true) ^ 1) >>> 0,
                true,
              );
            }
          },
          local: (index, header) => {
            if (parts[index]?.name === "xl/worksheets/sheet2.xml") {
              header.setUint32(
                14,
                (header.getUint32(14, true) ^ 1) >>> 0,
                true,
              );
            }
          },
        }),
    );
    const book = openWorkbook(bytes);
    if (typeof book === "string") throw new Error(book);
    expect(book.rows(1).rows).toEqual([]);
    expect(() => book.rows(2)).toThrow(XlsxError);
    try {
      book.rows(2);
    } catch (error) {
      expect([(error as XlsxError).code, (error as XlsxError).sheet]).toEqual([
        "zipChecksum",
        2,
      ]);
    }
  });

  it("reads a sheet once, however often it is asked for", () => {
    const book = open(one("<row><c><v>1</v></c></row>"));
    expect(book.rows(1)).toBe(book.rows(1));
    expect(() => book.rows(2)).toThrow(RangeError);
  });

  it("keeps a name planted in every part it never reads, or skips, out of what it gives", () => {
    const canary = "CANARY-Jane-Doe";
    const spec = (data: string): WorkbookSpec => ({
      sheets: [
        {
          name: "Trades",
          data,
          after: `<headerFooter><oddHeader>${canary}</oddHeader></headerFooter>`,
        },
      ],
      edit: (parts) => {
        parts.set("docProps/core.xml", `<x>${canary}</x>`);
        parts.set("customXml/item1.xml", `<x>${canary}</x>`);
        editing("xl/workbook.xml", (text) =>
          text.replace(
            "</sheets>",
            `</sheets><extLst><ext uri="{Y}"><x15ac:absPath url="C:\\Users\\${canary}\\" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></ext></extLst>`,
          ),
        )(parts);
      },
    });
    const book = open(spec("<row><c><v>1</v></c></row>"));
    expect(JSON.stringify([book.sheets, cells(book)])).not.toContain(canary);
    // And a refusal names its rule and place, never what it read.
    try {
      open(spec(`<row><c><v>${canary}</v></c></row>`)).rows(1);
      throw new Error("not refused");
    } catch (error) {
      if (!(error instanceof XlsxError)) throw error;
      expect(error.code).toBe("xlsxNumber");
      expect(
        JSON.stringify([
          error.message,
          error.code,
          error.sheet,
          error.row,
          error.column,
        ]),
      ).not.toContain(canary);
    }
  });
});

describe("the choke point", () => {
  it("is the only way into the ZIP reader and the decoder, in every package and app", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const sources: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = `${folder}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "dist")
            walk(path);
        } else if (
          /\.tsx?$/.test(entry.name) &&
          !/\.test\.tsx?$/.test(entry.name)
        ) {
          sources.push(path);
        }
      }
    };
    for (const group of ["packages", "apps"]) {
      for (const name of readdirSync(`${root}${group}`)) {
        const src = `${root}${group}/${name}/src`;
        try {
          walk(src);
        } catch {
          // A package without sources.
        }
      }
    }
    const importers = (module: string) => {
      const pattern = new RegExp(
        `(?:from|import)\\s*\\(?\\s*["'][^"']*\\b${module}(?:\\.js)?["']`,
      );
      return sources
        .filter((path) => !path.includes("/src/testing/"))
        .filter((path) => pattern.test(readFileSync(path, "utf8")))
        .map((path) => path.slice(path.lastIndexOf("/") + 1));
    };
    expect(importers("zip")).toEqual(["xlsx.ts"]);
    expect(importers("inflate")).toEqual(["zip.ts"]);
  });
});

/** A column's letters, for building references: 1 is A, 27 is AA. */
function columnName(column: number): string {
  let name = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(0x41 + ((n - 1) % 26)) + name;
  }
  return name;
}
