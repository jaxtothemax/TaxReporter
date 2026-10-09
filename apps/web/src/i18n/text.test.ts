import { describe, expect, it } from "vitest";

import { isTicker, plainText, printableName } from "./text";

describe("plainText", () => {
  it("leaves no character that displays as something else", () => {
    // A right-to-left override, a zero-width joiner, a tab, a line separator.
    expect(plainText("Apple\u202e cnI\u200d\tLtd\u2028x")).toBe(
      "Apple cnI Ltd x",
    );
    expect(plainText("  Coca-Cola  ")).toBe("Coca-Cola");
    expect(plainText("Nestlé S.A. č ž")).toBe("Nestlé S.A. č ž");
  });

  it("stays linear on input made to be slow", () => {
    const started = Date.now();
    plainText(`${" ".repeat(1_000_000)}x${"\u200b".repeat(1_000_000)}`);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("printableName", () => {
  it("shows hidden characters as ?, as the command line does", () => {
    expect(printableName("a\u001b[2Jb\u202ecsv.exe\u0085")).toBe(
      "a?[2Jb?csv.exe?",
    );
    expect(printableName("Izvoz 2026 (č).csv")).toBe("Izvoz 2026 (č).csv");
  });
});

describe("isTicker", () => {
  it("takes what tickers look like", () => {
    for (const symbol of [
      "AAPL",
      "BRK.B",
      "7203.T",
      "AAPL:xnas",
      "VWCE",
      "Ö",
    ]) {
      expect(isTicker(symbol), symbol).toBe(true);
    }
  });

  it("refuses a symbol that could pass for something else", () => {
    for (const symbol of [
      "",
      "MSFT (US5949181045)",
      // An ISIN of another security, which would read as its ticker.
      "US5949181045",
      " AAPL",
      "A".repeat(17),
      "AAPL\u202e",
    ]) {
      expect(isTicker(symbol), symbol).toBe(false);
    }
  });
});
