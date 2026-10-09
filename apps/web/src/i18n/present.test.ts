import { describe, expect, it } from "vitest";

import type { Finding } from "../model/preview";
import { findingText, isFindingCode, type FindingContext } from "./present";

const context = (locale: "en" | "sl"): FindingContext => ({
  locale,
  fileName: (file) => ["trading212-2026.csv", "ibkr.xml"][file] ?? "?",
  symbols: { US0378331005: "AAPL" },
});

const say = (finding: Finding, locale: "en" | "sl" = "en") =>
  findingText(finding, context(locale));

describe("findingText", () => {
  it("leads with the security as its ticker and ISIN, and the day", () => {
    const text = say({
      severity: "info",
      code: "splitAdjusted",
      params: { isin: "US0378331005", date: "2026-03-02", ratio: "4:1" },
    });
    expect(text).toMatch(/^AAPL \(US0378331005\), 2 Mar 2026: quantities/);
    expect(
      say(
        {
          severity: "info",
          code: "splitAdjusted",
          params: { isin: "US0378331005", date: "2026-03-02", ratio: "4:1" },
        },
        "sl",
      ),
    ).toMatch(/^AAPL \(US0378331005\), 2\. 3\. 2026: količine/);
  });

  it("shows an ISIN with no known ticker as it is", () => {
    expect(
      say({
        severity: "blocking",
        code: "payerUnknown",
        params: { isin: "US1912161007" },
      }),
    ).toMatch(/^US1912161007: Doh-Div needs/);
  });

  it("names files by the names the user gave them", () => {
    const text = say({
      severity: "blocking",
      code: "overlapMismatch",
      params: {
        kind: "trade",
        from: "2026-01-06",
        to: "2026-09-10",
        first: { file: 1 },
        second: { file: 0 },
      },
    });
    expect(text).toContain("ibkr.xml and trading212-2026.csv cover");
    expect(text).toContain("list different trades");
    expect(text).toContain("6 Jan 2026 to 10 Sept 2026");
  });

  it("words amounts, rates, countries and closed lists for the locale", () => {
    const excess: Finding = {
      severity: "warning",
      code: "excessWithholding",
      params: {
        isin: "DE0008404005",
        date: "2026-05-08",
        country: "DE",
        withheldEur: "32.49",
        treatyRate: "0.15",
        creditEur: "18.48",
        excessEur: "14.01",
      },
    };
    expect(say(excess)).toContain(
      "Germany withheld €32.49, but the tax treaty allows a credit of at most 15%",
    );
    expect(say(excess, "sl")).toContain("(Nemčija)");
    // The locale puts a no-break space before the euro sign.
    expect(say(excess, "sl")).toMatch(/32,49\s€/);
    expect(
      say({
        severity: "blocking",
        code: "summaryOnly",
        params: { section: "CashTransactions" },
      }),
    ).toContain("“Cash Transactions” section");
    expect(
      say({
        severity: "blocking",
        code: "tradeInconsistent",
        params: { check: "cusip" },
      }),
    ).toContain("disagree: its CUSIP does not match its ISIN.");
    expect(
      say({
        severity: "warning",
        code: "derivativesNotCovered",
        params: { broker: "ibkr", count: 1200 },
      }),
    ).toMatch(/^Interactive Brokers: option, .* \(1,200\)/);
  });

  it("words each reason from its own list", () => {
    expect(
      say({
        severity: "blocking",
        code: "fileRefused",
        params: { reason: "pdf" },
      }),
    ).toBe("This file is a PDF: export CSV or XML from your broker instead.");
    expect(
      say({
        severity: "blocking",
        code: "unreadableFile",
        params: { reason: "doctype", row: 1234 },
      }),
    ).toMatch(/never reads \(line 1234\)\. /);
    expect(
      say({
        severity: "blocking",
        code: "rateUnavailable",
        params: { currency: "TWD", date: "2026-02-01", reason: "noRate" },
      }),
    ).toContain("Banka Slovenije published none for that day");
  });

  it("names no ticker that could pass for something else", () => {
    const spoofed = findingText(
      {
        severity: "blocking",
        code: "payerUnknown",
        params: { isin: "US0378331005" },
      },
      { ...context("en"), symbols: { US0378331005: "MSFT (US5949181045)" } },
    );
    expect(spoofed).toMatch(/^US0378331005: Doh-Div needs/);
    // A key an object inherits is no ticker of any security.
    const inherited = findingText(
      {
        severity: "blocking",
        code: "payerUnknown",
        params: { isin: "constructor" },
      },
      context("en"),
    );
    expect(inherited).toMatch(/^constructor: Doh-Div needs/);
  });

  it("shows no character from a file that displays as something else", () => {
    const text = say({
      severity: "blocking",
      code: "unknownElement",
      params: { element: { untrusted: "Trades\u202eXX\u200b" } },
    });
    // Each becomes a space, so nothing reorders or hides the text around it.
    expect(text).toContain("“Trades XX”");
  });

  it("shows file text as text, cut to its length by the engine", () => {
    const text = say({
      severity: "blocking",
      code: "unknownElement",
      params: { element: { untrusted: "<img src=x onerror=alert(1)>" } },
    });
    expect(text).toContain("“<img src=x onerror=alert(1)>”");
  });

  it("keeps a value a closed list lacks, rather than breaking", () => {
    expect(
      say({
        severity: "blocking",
        code: "fileRefused",
        params: { reason: "toString" },
      }),
    ).toBe("This file toString.");
  });
});

describe("formIssue", () => {
  it("sends the user to the Details step for what they typed, and reports the rest", () => {
    const issue = (path: string) =>
      say({
        severity: "blocking",
        code: "formIssue",
        params: { code: "textTooLong", path },
      });
    expect(issue("taxpayer.postNumber")).toContain("Check the details there");
    expect(issue("dividends[2].payer.address")).toContain(
      "Check the details there",
    );
    expect(issue("dividends[2].sourceCountry")).toContain(
      "Check the details there",
    );
    expect(issue("lists[0].rows[3].quantity")).toContain("please report it");
  });
});

describe("isFindingCode", () => {
  it("knows the catalog's codes and nothing an object inherits", () => {
    expect(isFindingCode("payerUnknown")).toBe(true);
    expect(isFindingCode("constructor")).toBe(false);
    expect(isFindingCode("__proto__")).toBe(false);
  });
});
