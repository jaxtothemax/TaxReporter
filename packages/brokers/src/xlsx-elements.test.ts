/**
 * The workbook reader's element budget, LIMITS.xlsxElements made small:
 * one budget for every part of one file, at its value and one past it.
 */
import { describe, expect, it, vi } from "vitest";

import { makeWorkbook, type WorkbookSpec } from "./testing/workbook.js";
import { openWorkbook, XlsxError, type Workbook } from "./xlsx.js";

const ELEMENTS = vi.hoisted(() => 30);

vi.mock("@taxreporter/core", async (original) => {
  const core = await original<typeof import("@taxreporter/core")>();
  return {
    ...core,
    LIMITS: Object.freeze({ ...core.LIMITS, xlsxElements: ELEMENTS }),
  };
});

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

const cells = (n: number) => `<row>${"<c><v>1</v></c>".repeat(n)}</row>`;

describe("openWorkbook, its element budget", () => {
  it("holds the elements of every part of one file to one budget", () => {
    // A one-sheet workbook's other parts take 18 elements, its worksheet
    // and sheetData 2 more: 20, then 1 a row and 2 a cell with its value.
    const sheet = (data: string) => ({ sheets: [{ name: "A", data }] });
    expect(refusal(sheet(`<row/>${cells(4)}`))).toBe("none"); // 30
    expect(refusal(sheet(`<row/><row/>${cells(4)}`))).toBe("tooManyElements");
    // Two sheets that each fit alone, and not together.
    expect(refusal(sheet(cells(3)))).toBe("none");
    expect(
      refusal({
        sheets: [
          { name: "A", data: cells(1) },
          { name: "B", data: cells(1) },
        ],
      }),
    ).toBe("tooManyElements");
  });
});
