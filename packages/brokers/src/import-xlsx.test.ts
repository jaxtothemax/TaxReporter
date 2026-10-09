/**
 * The XLSX family at intake (ADR 0014 §11): a ZIP is opened as a workbook,
 * refused for what it is when it is none, and handed to the one adapter
 * its sheet list matches, which reads only the Workbook.
 */
import { diagnostic, type FileId } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import {
  importFile,
  importXlsx,
  XLSX_ADAPTERS,
  type ImportResult,
  type XlsxAdapter,
} from "./adapter.js";
import { CONTENT_TYPE, makeWorkbook } from "./testing/workbook.js";
import { makeZip } from "./testing/zip-writer.js";

const context = { fileId: "0123456789abcdef" as FileId, accountGroup: 1 };

const book = makeWorkbook({
  sheets: [
    { name: "Closed Positions", data: "<row><c><v>1</v></c></row>" },
    { name: "Bad", data: '<row r="4"><c r="C4"><f>A1</f><v>1</v></c></row>' },
  ],
});

/** An adapter for the test: it reads sheet 1, or the sheet it is told. */
function adapter(name: string, sheet = 1): XlsxAdapter & { seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    broker: name,
    seen,
    matches(info) {
      seen.push(info);
      return info.sheets.some((s) => s.name === "Closed Positions");
    },
    read(workbook): ImportResult {
      const rows = workbook.rows(sheet).rows.length;
      return {
        broker: name,
        format: `${name}-xlsx`,
        events: [],
        diagnostics: [
          diagnostic("info", "diagnosticsTruncated", { dropped: rows }),
        ],
        reach: [],
      };
    },
  };
}

describe("importFile, the XLSX family", () => {
  it("has no XLSX adapter yet, so reads a workbook and does not recognize it", () => {
    expect(XLSX_ADAPTERS).toEqual([]);
    expect(importFile({ bytes: book, ...context }).diagnostics).toEqual([
      diagnostic("blocking", "unknownFormat", {}),
    ]);
  });

  it("refuses a ZIP that is no workbook, and one that carries macros", () => {
    const zip = makeZip([{ name: "a.txt", content: new Uint8Array([65]) }]);
    expect(importFile({ bytes: zip, ...context }).diagnostics).toEqual([
      diagnostic("blocking", "fileRefused", { reason: "zip" }),
    ]);
    const macros = makeWorkbook({
      sheets: [{ name: "A" }],
      edit: (parts) => {
        const types = parts.get("[Content_Types].xml") as string;
        parts.set(
          "[Content_Types].xml",
          types.replace(
            CONTENT_TYPE.workbook,
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
          ),
        );
      },
    });
    expect(importFile({ bytes: macros, ...context }).diagnostics).toEqual([
      diagnostic("blocking", "fileRefused", { reason: "macroWorkbook" }),
    ]);
  });

  it("refuses a binary and a Strict workbook for what they are", () => {
    const binary = makeWorkbook({
      sheets: [{ name: "A" }],
      edit: (parts) => {
        const types = parts.get("[Content_Types].xml") as string;
        parts.set(
          "[Content_Types].xml",
          types.replace(
            CONTENT_TYPE.workbook,
            "application/vnd.ms-excel.sheet.binary.macroEnabled.main",
          ),
        );
      },
    });
    const strict = makeWorkbook({
      sheets: [{ name: "A" }],
      edit: (parts) => {
        const rels = parts.get("_rels/.rels") as string;
        parts.set(
          "_rels/.rels",
          rels.replace(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
            "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
          ),
        );
      },
    });
    expect(importFile({ bytes: binary, ...context }).diagnostics).toEqual([
      diagnostic("blocking", "fileRefused", { reason: "binaryWorkbook" }),
    ]);
    expect(importFile({ bytes: strict, ...context }).diagnostics).toEqual([
      diagnostic("blocking", "fileRefused", { reason: "strictWorkbook" }),
    ]);
  });
});

describe("importXlsx", () => {
  it("hands the workbook to the one adapter its sheet list matches", () => {
    const only = adapter("broker");
    const result = importXlsx(book, context, [only]);
    expect(result.format).toBe("broker-xlsx");
    expect(result.diagnostics).toEqual([
      diagnostic("info", "diagnosticsTruncated", { dropped: 1 }),
    ]);
    // Choosing saw the sheet list and the date system, nothing to read.
    expect(only.seen).toEqual([
      {
        sheets: [
          {
            position: 1,
            name: "Closed Positions",
            hidden: false,
            worksheet: true,
          },
          { position: 2, name: "Bad", hidden: false, worksheet: true },
        ],
        date1904: false,
      },
    ]);
  });

  it("refuses a workbook two adapters match", () => {
    expect(
      importXlsx(book, context, [adapter("a"), adapter("b")]).diagnostics,
    ).toEqual([diagnostic("blocking", "ambiguousFormat", {})]);
  });

  it("refuses with the rule and the place of a sheet the adapter could not read", () => {
    expect(
      importXlsx(book, context, [adapter("broker", 2)]).diagnostics,
    ).toEqual([
      diagnostic("blocking", "unreadableFile", {
        reason: "xlsxFormula",
        row: 4,
        sheet: 2,
        column: 3,
      }),
    ]);
  });
});
