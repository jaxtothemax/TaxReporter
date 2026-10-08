import { describe, expect, it } from "vitest";

import { isTaxNumber, toPlainLine } from "./common.js";

const char = (point: number) => String.fromCodePoint(point);

describe("toPlainLine", () => {
  it("turns what a FURS field refuses into spaces, then folds them", () => {
    // A right-to-left mark, NEL (a Windows-1252 ellipsis read as Latin-1),
    // a zero-width space, a tab and a line break.
    const name = `Acme${char(0x200f)} Corp${char(0x85)}${char(0x200b)}\tInc.\n`;
    expect(toPlainLine(name)).toBe("Acme Corp Inc.");
  });

  it("drops what XML cannot carry at all", () => {
    expect(
      toPlainLine(`A${char(0xfffe)}B${String.fromCharCode(0xd800)}C`),
    ).toBe("A B C");
    expect(toPlainLine(`A${char(0)}B`)).toBe("A B");
  });

  it("keeps letters of any script, and gives undefined for nothing", () => {
    expect(toPlainLine("Königinstraße, člen 😀")).toBe(
      "Königinstraße, člen 😀",
    );
    expect(toPlainLine(` ${char(0x200b)}\t`)).toBeUndefined();
    expect(toPlainLine(undefined)).toBeUndefined();
  });
});

describe("isTaxNumber", () => {
  it("is a plain boolean test, refusing numbers rather than coercing them", () => {
    expect(isTaxNumber("12345678")).toBe(true);
    expect(isTaxNumber(12345678)).toBe(false);
    expect(isTaxNumber("00000000")).toBe(false);
  });
});
