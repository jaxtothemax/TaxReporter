import { describe, expect, it } from "vitest";

import { engineReplies } from "../testing/ownFiles";
import { isFinding, isReply, isRequest, PROTOCOL_VERSION } from "./protocol";

const finding = {
  severity: "blocking",
  code: "unknownElement",
  params: { element: { untrusted: "<b>Foo</b>" }, first: { file: 0 } },
  source: { file: 0, row: 3 },
};

const read = {
  v: PROTOCOL_VERSION,
  id: 4,
  kind: "read",
  files: [
    {
      status: "read",
      broker: "ibkr",
      firstDate: "2025-01-02",
      lastDate: "2026-09-30",
      rows: 12,
      sameAs: null,
      unnamedAccount: false,
      findings: [finding],
    },
  ],
  findings: [finding],
  omittedFindings: 0,
  payers: [
    {
      isin: "US1912161007",
      symbol: "KO",
      name: "Coca-Cola",
      isinCountry: "US",
      broker: "trading212",
      payments: 2,
    },
  ],
  symbols: { US1912161007: "KO" },
};

const request = {
  v: PROTOCOL_VERSION,
  id: 1,
  kind: "prepare",
  files: [{ name: "a.csv", bytes: new ArrayBuffer(3) }],
  accounts: "same",
  taxYear: 2026,
  taxpayer: {
    taxNumber: "12345678",
    name: "",
    address: "",
    postCode: "",
    city: "",
    email: "",
  },
  payers: [
    {
      isin: "US1912161007",
      name: "The Coca-Cola Company",
      address: "Atlanta",
      country: "US",
      id: "",
      sourceCountry: "",
    },
  ],
};

describe("isReply", () => {
  it("takes a reply of this version and shape", () => {
    expect(isReply(read)).toBe(true);
    expect(isReply({ v: PROTOCOL_VERSION, id: 2, kind: "failed" })).toBe(true);
  });

  it("drops another version, an unknown kind or a broken envelope", () => {
    for (const bad of [
      null,
      "read",
      { ...read, v: 2 },
      { ...read, id: -1 },
      { ...read, id: 1.5 },
      { ...read, kind: "write" },
      { ...read, files: [{ ...read.files[0], broker: "etoro" }] },
      { ...read, files: [{ ...read.files[0], status: "maybe" }] },
      { ...read, payers: [{ isin: "X" }] },
      { ...read, symbols: { X: 1 } },
      { ...read, findings: "none" },
      { ...read, files: [{ ...read.files[0], findings: [{ code: "x" }] }] },
    ]) {
      expect(isReply(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("isFinding", () => {
  it("takes a code the catalog says, with plain, file and file-text values", () => {
    expect(isFinding(finding)).toBe(true);
    expect(isFinding({ ...finding, source: undefined })).toBe(true);
  });

  it("takes a workbook's place: its sheet, row and column, as numbers", () => {
    expect(
      isFinding({
        severity: "blocking",
        code: "unreadableFile",
        params: { reason: "xlsxFormula", row: 12, sheet: 2, column: 3 },
      }),
    ).toBe(true);
  });

  it("drops an unknown code, severity or parameter shape", () => {
    for (const bad of [
      { ...finding, code: "toString" },
      { ...finding, code: "noSuchCode" },
      { ...finding, severity: "fatal" },
      { ...finding, params: { x: { untrusted: 1 } } },
      { ...finding, params: { x: { file: "a.csv" } } },
      { ...finding, params: { x: { file: 0, untrusted: "y" } } },
      { ...finding, params: { x: [1] } },
      { ...finding, params: { x: Number.NaN } },
      { ...finding, source: { file: 0 } },
    ]) {
      expect(isFinding(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("isRequest", () => {
  it("takes a read and a prepare of this version", () => {
    expect(isRequest(request)).toBe(true);
    expect(
      isRequest({
        ...request,
        kind: "read",
        taxpayer: undefined,
        payers: undefined,
      }),
    ).toBe(true);
  });

  it("drops anything else", () => {
    for (const bad of [
      { ...request, v: 0 },
      { ...request, kind: "delete" },
      { ...request, accounts: "all" },
      { ...request, taxYear: "2026" },
      { ...request, files: [{ name: "a.csv", bytes: "abc" }] },
      { ...request, files: [{ bytes: new ArrayBuffer(1) }] },
      { ...request, taxpayer: { ...request.taxpayer, email: undefined } },
      { ...request, payers: [{ isin: "X" }] },
    ]) {
      expect(isRequest(bad)).toBe(false);
    }
  });
});

describe("isReply on the review", () => {
  it("takes the engine's own prepared reply, and none with a field broken", async () => {
    const { prepared } = await engineReplies();
    expect(isReply(prepared)).toBe(true);
    const { preview } = prepared;
    const [security] = preview.securities;
    const [dividend] = preview.dividends;
    if (security === undefined || dividend === undefined) {
      throw new Error("the fixtures have a sale and a dividend");
    }
    const [row] = security.rows;
    const [lot] = security.lots;
    const [file] = preview.files;
    const rate = dividend.rate;
    if (row === undefined || lot === undefined || file === undefined) {
      throw new Error("a sale has rows and lots, and a file was read");
    }
    if (rate === null) throw new Error("a dollar dividend has a rate");
    const broken = [
      // A value the formatters would throw on, a date that is none.
      { ...preview, gainsTotals: { ...preview.gainsTotals, gainEur: "1e3" } },
      { ...preview, dividends: [{ ...dividend, date: "1. 4. 2026" }] },
      { ...preview, dividends: [{ ...dividend, date: "2026-02-30" }] },
      { ...preview, dividends: [{ ...dividend, grossEur: { amount: "1" } }] },
      // A row from another kind of list, a broker the screens cannot name.
      {
        ...preview,
        securities: [{ ...security, rows: [{ ...row, kind: "gift" }] }],
      },
      { ...preview, securities: [{ ...security, brokers: ["etoro"] }] },
      // Keys that are no ISINs, a bucket that is no bucket.
      { ...preview, symbols: { constructor: "X" } },
      { ...preview, securities: [{ ...security, isin: "AAPL" }] },
      {
        ...preview,
        gainsEstimate: {
          ...preview.gainsEstimate,
          positiveByBucket: { "25": "1.00" },
        },
      },
      { ...preview, omittedFindings: -1 },
      // Every list and record the screens read, each checked in full.
      { ...preview, files: [{ ...file, rowsRead: -1 }] },
      { ...preview, findings: [{ severity: "fatal", code: "x", params: {} }] },
      { ...preview, dividendsByMonth: [{ month: "2026-13", grossEur: "1" }] },
      {
        ...preview,
        dividends: [{ ...dividend, rate: { ...rate, source: "ecb" } }],
      },
      {
        ...preview,
        securities: [{ ...security, lots: [{ ...lot, bucket: "forever" }] }],
      },
      { ...preview, dividends: [{ ...dividend, treatyRate: "15%" }] },
      {
        ...preview,
        dividends: [{ ...dividend, source: { file: 1, row: 2 } }],
      },
      {
        ...preview,
        securities: [
          {
            ...security,
            rows: [{ ...row, splitAdjusted: { ratio: 2, date: "2026-01-01" } }],
          },
        ],
      },
    ];
    for (const [at, bad] of broken.entries()) {
      expect(isReply({ ...prepared, preview: bad }), `case ${String(at)}`).toBe(
        false,
      );
    }
    // And the reply around the review.
    for (const [at, bad] of [
      { ...prepared, files: [{ name: "a.csv" }] },
      { ...prepared, kdvp: { ...prepared.kdvp, xml: 1 } },
      { ...prepared, div: { ...prepared.div, needed: "yes" } },
    ].entries()) {
      expect(isReply(bad), `reply case ${String(at)}`).toBe(false);
    }
  });
});
