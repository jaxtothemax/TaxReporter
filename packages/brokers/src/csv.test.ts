import { describe, expect, it } from "vitest";

import { CSV_LIMITS, CsvError, readCsv, type CsvLimits } from "./csv.js";

/** The code of the CsvError `read` throws, or "none". */
function failure(read: () => unknown): string {
  try {
    read();
    return "none";
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    return `${error.code} ${String(error.row)}`;
  }
}

const cells = (text: string) => readCsv(text).rows.map((r) => r.cells);

describe("readCsv", () => {
  it("reads a header and rows, numbered as a spreadsheet numbers them", () => {
    const table = readCsv("Action,Total\nDeposit,10\r\nWithdrawal,-5\n");
    expect(table.header).toEqual(["Action", "Total"]);
    expect(table.rows).toEqual([
      { row: 2, cells: ["Deposit", "10"] },
      { row: 3, cells: ["Withdrawal", "-5"] },
    ]);
    expect([table.column("Total"), table.column("Missing")]).toEqual([
      1,
      undefined,
    ]);
  });

  it("reads quoted cells: commas, doubled quotes and line breaks inside", () => {
    expect(
      cells('Name,Notes\n"Procter & Gamble, Co","say ""hi""\nthere"\n'),
    ).toEqual([["Procter & Gamble, Co", 'say "hi"\nthere']]);
  });

  it("keeps empty cells, a trailing one included", () => {
    expect(cells("A,B,C\n,x,\n")).toEqual([["", "x", ""]]);
    expect(cells('A,B\n"",\n')).toEqual([["", ""]]);
  });

  it("strips a byte-order mark and skips empty lines, which still count as rows", () => {
    const table = readCsv(
      `${String.fromCharCode(0xfeff)}A,B\n\n1,2\r\n\r\n3,4`,
    );
    expect(table.header).toEqual(["A", "B"]);
    expect(table.rows.map((r) => r.row)).toEqual([3, 5]);
  });

  it("refuses broken quoting rather than guessing where a cell ends", () => {
    expect(failure(() => readCsv('A,B\n"open,1\n'))).toBe(
      "unterminatedQuote 2",
    );
    expect(failure(() => readCsv('A,B\nx"y,1\n'))).toBe("strayQuote 2");
    expect(failure(() => readCsv('A,B\n"x"y,1\n'))).toBe("strayQuote 2");
  });

  it("refuses a carriage return that ends no line", () => {
    expect(failure(() => readCsv("A,B\n1\r2,3\n"))).toBe(
      "strayCarriageReturn 2",
    );
  });

  it("refuses a row with too few or too many cells", () => {
    // An unquoted name with a comma in it, as an early export wrote them.
    expect(failure(() => readCsv("Name,Total\nAcme, Inc.,10\n"))).toBe(
      "rowLength 2",
    );
    expect(failure(() => readCsv("A,B\n1\n"))).toBe("rowLength 2");
  });

  it("refuses a header that is missing, empty or repeated", () => {
    expect(failure(() => readCsv(""))).toBe("noHeader 0");
    expect(failure(() => readCsv("\n\n"))).toBe("noHeader 0");
    expect(failure(() => readCsv("\nA,,B\n1,2,3\n"))).toBe("emptyHeaderName 2");
    expect(failure(() => readCsv("A,B,A\n1,2,3\n"))).toBe(
      "duplicateHeaderName 1",
    );
  });

  it("keeps header names away from object prototypes", () => {
    const table = readCsv("__proto__,constructor\n1,2\n");
    expect(table.column("__proto__")).toBe(0);
    expect(table.column("constructor")).toBe(1);
    expect(readCsv("A\n1\n").column("constructor")).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("enforces its limits", () => {
    const tight: CsvLimits = {
      maxLength: 40,
      maxRows: 2,
      maxColumns: 3,
      maxCellLength: 5,
    };
    expect(failure(() => readCsv("x".repeat(41), tight))).toBe("tooLarge 0");
    expect(failure(() => readCsv("A\n1\n2\n3\n", tight))).toBe("tooManyRows 4");
    expect(failure(() => readCsv("A,B,C,D\n", tight))).toBe("tooManyColumns 1");
    expect(failure(() => readCsv("A\n123456\n", tight))).toBe("cellTooLong 2");
    expect(failure(() => readCsv('A\n"123456"\n', tight))).toBe(
      "cellTooLong 2",
    );
    expect(failure(() => readCsv('A\n"12""34"\n', tight))).toBe("none");
    expect(Object.isFrozen(CSV_LIMITS)).toBe(true);
  });

  it("reads pathological quoting in linear time", () => {
    const quotes = '""'.repeat(500_000);
    const limits = { ...CSV_LIMITS, maxCellLength: 1_000_000 };
    const started = Date.now();
    const table = readCsv(`A\n"${quotes}"\n`, limits);
    expect(table.rows[0]?.cells[0]).toHaveLength(500_000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("names a rule and a row in its errors, never a value", () => {
    try {
      readCsv('Name,Account\n"Janez Novak",SI56 0000 0000 0000 000,x\n');
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toBe("CsvError: CSV rowLength at row 2");
    }
  });
});
