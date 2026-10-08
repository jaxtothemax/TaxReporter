import { describe, expect, it } from "vitest";

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
  payers: [
    {
      isin: "US1912161007",
      symbol: "KO",
      name: "Coca-Cola",
      isinCountry: "US",
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
