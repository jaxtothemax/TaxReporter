/**
 * The workbook reader's counts, with their LIMITS made small: rows, cells,
 * shared strings and the cells' text, each at its value and one past it,
 * and each counted across every sheet of one file.
 */
import { describe, expect, it, vi } from "vitest";

import { makeWorkbook, type WorkbookSpec } from "./testing/workbook.js";
import { openWorkbook, XlsxError, type Workbook } from "./xlsx.js";

const SMALL = vi.hoisted(() => ({
  recordsPerFile: 3,
  cellsPerFile: 4,
  sharedStrings: 2,
  fileBytes: 6,
}));

vi.mock("@taxreporter/core", async (original) => {
  const core = await original<typeof import("@taxreporter/core")>();
  return { ...core, LIMITS: Object.freeze({ ...core.LIMITS, ...SMALL }) };
});

/** The code a workbook is refused with when every sheet is read, or "none". */
function refusal(spec: WorkbookSpec): string {
  try {
    const book = openWorkbook(makeWorkbook(spec)) as Workbook | string;
    if (typeof book === "string") return book;
    for (const sheet of book.sheets) book.rows(sheet.position);
    return "none";
  } catch (error) {
    if (!(error instanceof XlsxError)) throw error;
    return error.code;
  }
}

const rows = (n: number) => "<row/>".repeat(n);
const cells = (n: number) => `<row>${"<c><v>1</v></c>".repeat(n)}</row>`;

describe("openWorkbook, its counts", () => {
  it("holds the rows of the sheets read at the limit, across sheets", () => {
    expect(refusal({ sheets: [{ name: "A", data: rows(3) }] })).toBe("none");
    expect(refusal({ sheets: [{ name: "A", data: rows(4) }] })).toBe(
      "xlsxRows",
    );
    expect(
      refusal({
        sheets: [
          { name: "A", data: rows(2) },
          { name: "B", data: rows(2) },
        ],
      }),
    ).toBe("xlsxRows");
  });

  it("holds the cells at the limit, across sheets", () => {
    expect(refusal({ sheets: [{ name: "A", data: cells(4) }] })).toBe("none");
    expect(refusal({ sheets: [{ name: "A", data: cells(5) }] })).toBe(
      "xlsxCells",
    );
    expect(
      refusal({
        sheets: [
          { name: "A", data: cells(3) },
          { name: "B", data: cells(2) },
        ],
      }),
    ).toBe("xlsxCells");
  });

  it("holds the shared strings at the limit", () => {
    const sheet = { name: "A", data: '<row><c t="s"><v>0</v></c></row>' };
    expect(
      refusal({ sheets: [sheet], strings: ["<t>a</t>", "<t>b</t>"] }),
    ).toBe("none");
    expect(
      refusal({
        sheets: [sheet],
        strings: ["<t>a</t>", "<t>b</t>", "<t>c</t>"],
      }),
    ).toBe("xlsxSharedStrings");
  });

  it("counts a shared string's text at every use, against the file's bound", () => {
    const uses = (n: number) => ({
      sheets: [
        { name: "A", data: `<row>${'<c t="s"><v>0</v></c>'.repeat(n)}</row>` },
      ],
      strings: ["<t>abc</t>"],
    });
    // Two uses are 6 characters, three are 9: one string, read thrice.
    expect(refusal(uses(2))).toBe("none");
    expect(refusal(uses(3))).toBe("xlsxText");
  });
});
