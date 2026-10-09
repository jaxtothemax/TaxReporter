/**
 * The engine as the worker runs it, over the broker fixtures: what the page
 * gets back for a read and for a prepared return, and that the XML is the
 * very XML the command line writes for the same files (ADR 0013 §1).
 */
import { writeDohDiv, writeDohKdvp } from "@taxreporter/furs";
import { prepareReturns } from "@taxreporter/pipeline";
import { describe, expect, it, vi } from "vitest";

import ibkrXml from "../../../../packages/brokers/test/fixtures/ibkr/flex-activity-2025-2026.xml?raw";
import t212v3 from "../../../../packages/brokers/test/fixtures/trading212/t212-invest-v3-2025.csv?raw";
import t212v4 from "../../../../packages/brokers/test/fixtures/trading212/t212-invest-v4-2026.csv?raw";
import { handleRequest, payersOf, taxpayerOf } from "./handle";
import {
  isReply,
  PROTOCOL_VERSION,
  type EngineReply,
  type PayerDetails,
  type PrepareReply,
  type ReadReply,
  type RequestFile,
  type TaxpayerDetails,
} from "./protocol";
import { loadRates } from "./rates";

const bytesOf = (text: string) => new TextEncoder().encode(text);
const file = (name: string, text: string): RequestFile => ({
  name,
  bytes: bytesOf(text).buffer,
});
const files = [
  file("t212-2025.csv", t212v3),
  file("t212-2026.csv", t212v4),
  file("ibkr.xml", ibkrXml),
];

const taxpayer: TaxpayerDetails = {
  taxNumber: "1234 5678",
  name: "Ana Novak",
  address: "Trubarjeva 1",
  postCode: "1000",
  city: "Ljubljana",
  email: "",
};
const coca: PayerDetails = {
  isin: "US1912161007",
  name: "The Coca-Cola Company",
  address: "One Coca-Cola Plaza, Atlanta, GA 30313, United States",
  country: "US",
  id: "",
  sourceCountry: "",
};

const base = { v: PROTOCOL_VERSION, accounts: "same", taxYear: 2026 } as const;

async function read(
  request: readonly RequestFile[] = files,
): Promise<ReadReply> {
  const reply = await handleRequest(
    { ...base, id: 1, kind: "read", files: request },
    loadRates,
  );
  if (reply.kind !== "read") throw new Error(`no read: ${reply.kind}`);
  return reply;
}

async function prepare(
  payers: readonly PayerDetails[] = [coca],
): Promise<PrepareReply> {
  const reply = await handleRequest(
    { ...base, id: 2, kind: "prepare", files, taxpayer, payers },
    loadRates,
  );
  if (reply.kind !== "prepare") throw new Error(`no prepare: ${reply.kind}`);
  return reply;
}

/** The reply as it reaches the page: through structured clone, then checked. */
function delivered(reply: EngineReply): unknown {
  return structuredClone(reply);
}

describe("handleRequest: read", () => {
  it("says what each file is, with no taxpayer and no rates", async () => {
    const reply = await handleRequest(
      { ...base, id: 7, kind: "read", files },
      () => Promise.reject(new Error("not needed")),
    );
    if (reply.kind !== "read") throw new Error(reply.kind);
    expect(reply.id).toBe(7);
    expect(
      reply.files.map((f) => [f.status, f.broker, f.unnamedAccount]),
    ).toEqual([
      ["read", "trading212", true],
      ["read", "trading212", true],
      ["read", "ibkr", false],
    ]);
    for (const summary of reply.files) {
      expect(summary.firstDate).toMatch(/^20\d\d-\d\d-\d\d$/);
      const span = [summary.firstDate, summary.lastDate];
      expect([...span].sort()).toEqual(span);
      expect(summary.rows).toBeGreaterThan(0);
    }
    expect(reply.findings.filter((f) => f.severity === "blocking")).toEqual([]);
    expect(isReply(delivered(reply))).toBe(true);
  });

  it("asks for the payer of every security that paid in the year", async () => {
    const reply = await read();
    expect(reply.payers.map((p) => [p.isin, p.isinCountry])).toContainEqual([
      "US1912161007",
      "US",
    ]);
    const coke = reply.payers.find((p) => p.isin === "US1912161007");
    expect(coke?.payments).toBeGreaterThan(1);
    expect(reply.symbols["US1912161007"]).toBe("KO");
  });

  it("marks a repeat and a file no adapter reads, by position", async () => {
    const reply = await read([
      files[0] as RequestFile,
      file("again.csv", t212v3),
      file("notes.csv", "Date,Note\n2026-01-02,hello\n"),
    ]);
    expect(reply.files.map((f) => [f.status, f.sameAs])).toEqual([
      ["read", null],
      ["repeat", 0],
      ["refused", null],
    ]);
    // A file's refusal is said beside it, not again for the files together.
    const refusal = reply.files[2]?.findings.find(
      (f) => f.code === "unknownFormat",
    );
    expect(refusal?.severity).toBe("blocking");
    expect(reply.findings.some((f) => f.code === "unknownFormat")).toBe(false);
  });

  it("names the files of a finding by their position, never by name", async () => {
    // The 2026 export again, with a trade in the middle gone: two exports
    // of one account that disagree about the same days.
    const cut = t212v4
      .split("\n")
      .filter((line) => !line.includes("EOF0000003002"))
      .join("\n");
    const reply = await read([file("whole.csv", t212v4), file("cut.csv", cut)]);
    const mismatch = reply.findings.find((f) => f.code === "overlapMismatch");
    // The ledger orders the two by file ID; either way, both are named.
    const named = [mismatch?.params["first"], mismatch?.params["second"]];
    expect(named).toEqual(expect.arrayContaining([{ file: 0 }, { file: 1 }]));
    expect(JSON.stringify(reply)).not.toContain("whole.csv");
  });
});

describe("handleRequest: prepare", () => {
  it("writes the XML the command line writes for the same files", async () => {
    const reply = await prepare();
    const cli = prepareReturns({
      files: files.map((f) => ({
        name: f.name,
        bytes: new Uint8Array(f.bytes),
      })),
      taxYear: 2026,
      taxpayer: taxpayerOf(taxpayer),
      rates: await loadRates(),
      payers: payersOf([coca]),
    });
    if (cli.kdvp.form === null || cli.div.form === null) {
      throw new Error("the CLI wrote no form");
    }
    expect(reply.kdvp.xml).toBe(writeDohKdvp(cli.kdvp.form));
    expect(reply.div.xml).toBe(writeDohDiv(cli.div.form));
    expect([reply.kdvp.blocking, reply.div.blocking]).toEqual([0, 0]);
    expect(reply.kdvp.xml).toContain("<edp:taxNumber>12345678</");
    expect(isReply(delivered(reply))).toBe(true);
  });

  it("shows the review the figures the forms hold", async () => {
    const { preview } = await prepare();
    expect(preview.securities.map((s) => s.isin)).toEqual([
      "IE00BK5BQT80",
      "US00000ACME1",
      "US0378331005",
      "US1912161007",
    ]);
    for (const security of preview.securities) {
      expect(security.lots.length).toBeGreaterThan(0);
      expect(security.proceedsEur).toMatch(/^-?\d+\.\d{2}$/);
      for (const row of security.rows) {
        expect(row.source.file).toMatch(/\.(csv|xml)$/);
      }
    }
    const coke = preview.dividends.filter((d) => d.isin === "US1912161007");
    expect(coke.length).toBeGreaterThan(1);
    expect(coke[0]?.payer).toBe("The Coca-Cola Company");
    expect(coke[0]?.country).toBe("US");
    expect(preview.dividendsByMonth).toHaveLength(12);
    expect(preview.dividendsEstimate.taxRate).toBe("0.25");
  });

  it("withholds only Doh-Div while a payer is missing", async () => {
    const reply = await prepare([]);
    expect(reply.kdvp.xml).not.toBeNull();
    expect(reply.div.xml).toBeNull();
    expect(reply.div.blocking).toBeGreaterThan(0);
    expect(reply.div.needed).toBe(true);
    expect(
      reply.preview.findings.some(
        (f) => f.code === "payerUnknown" && f.severity === "blocking",
      ),
    ).toBe(true);
  });

  it("fails without a word when the engine cannot finish", async () => {
    const reply = await handleRequest(
      { ...base, id: 9, kind: "prepare", files, taxpayer, payers: [coca] },
      () => Promise.reject(new Error("secret file text")),
    );
    expect(reply).toEqual({ v: PROTOCOL_VERSION, id: 9, kind: "failed" });
  });
});

describe("handleRequest: what reaches the page", () => {
  const header = t212v4.split("\n")[0] ?? "";

  it("carries at most 500 findings about the files together", async () => {
    // Forty exports of one account, each the same day with another trade:
    // every pair overlaps and disagrees, 780 findings in all.
    const exports = Array.from({ length: 40 }, (_, i) =>
      file(
        `part-${String(i)}.csv`,
        [
          header,
          `Market buy,2026-01-06 14:31:02+00:00,US1912161007,KO,"Coca-Cola",,EOF${String(i)},${String(i + 1)}.0000000000,69.5000000000,USD,1.17250000,,,59.28,"EUR",,,,,,`,
        ].join("\n"),
      ),
    );
    const reply = await read(exports);
    expect(reply.findings).toHaveLength(500);
    expect(reply.omittedFindings).toBe(780 - 500);
  });

  it("carries at most 500 findings, and counts the rest", async () => {
    // A row of an action no adapter knows, 600 times: a finding each.
    const rows = Array.from(
      { length: 600 },
      (_, i) =>
        `Mystery,2026-01-06 14:31:02+00:00,,,,,ID${String(i)},,,,,,,1.00,"EUR",,,,,,`,
    );
    const flood = file("flood.csv", [header, ...rows].join("\n"));
    const reply = await read([flood]);
    expect(reply.files[0]?.findings).toHaveLength(500);
    const prepared = await handleRequest(
      { ...base, id: 3, kind: "prepare", files: [flood], taxpayer, payers: [] },
      loadRates,
    );
    if (prepared.kind !== "prepare") throw new Error(prepared.kind);
    expect(prepared.preview.findings).toHaveLength(500);
    expect(prepared.preview.omittedFindings).toBeGreaterThanOrEqual(100);
    // Withheld over every finding, not only the ones carried.
    expect(prepared.kdvp.blocking).toBeGreaterThan(500);
  });

  it("names a dividend's payer without what would display as something else", async () => {
    // Every row of the security, its dividend's included.
    const spoofed = t212v4.replaceAll('"Coca-Cola"', '"Coca\u202eCola\u200b"');
    expect(spoofed).not.toContain('"Coca-Cola"');
    const prepared = await handleRequest(
      {
        ...base,
        id: 4,
        kind: "prepare",
        files: [file("t212.csv", spoofed)],
        taxpayer,
        payers: [],
      },
      loadRates,
    );
    if (prepared.kind !== "prepare") throw new Error(prepared.kind);
    const payers = prepared.preview.dividends.map((d) => d.payer);
    expect(payers.length).toBeGreaterThan(0);
    expect(payers.every((name) => !/[\u200b\u202e]/u.test(name))).toBe(true);
  });
});

describe("handleRequest: no request leaves the engine", () => {
  it("reads and prepares with every network API watching, and none is used", async () => {
    // The spec's check (docs/spec/v0.1.md, the browser app): nothing the
    // engine does during an import reaches for the network. Each API is
    // replaced by one that records a call and refuses it.
    const calls: string[] = [];
    const refuse = (name: string) =>
      function refused(): never {
        calls.push(name);
        throw new Error("No request may leave the engine");
      };
    for (const name of [
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "importScripts",
    ]) {
      vi.stubGlobal(name, refuse(name));
    }
    const reply = await handleRequest(
      { ...base, id: 5, kind: "read", files },
      loadRates,
    );
    const prepared = await handleRequest(
      { ...base, id: 6, kind: "prepare", files, taxpayer, payers: [coca] },
      loadRates,
    );
    expect([reply.kind, prepared.kind]).toEqual(["read", "prepare"]);
    expect(calls).toEqual([]);
  });
});

describe("taxpayerOf and payersOf", () => {
  it("leave out what was not typed, and keep spaces out of the tax number", () => {
    expect(taxpayerOf(taxpayer)).toEqual({
      taxNumber: "12345678",
      name: "Ana Novak",
      address: "Trubarjeva 1",
      city: "Ljubljana",
      postNumber: "1000",
    });
  });

  it("take a payer only with a name, an address and a FURS country", () => {
    const payers = payersOf([
      coca,
      { ...coca, isin: "A", address: "  " },
      { ...coca, isin: "B", country: "XX" },
      { ...coca, isin: "C", id: " 58-0628465 " },
      { ...coca, isin: "D", country: "SI", id: "12345678" },
      { ...coca, isin: "E", country: "SI", id: "not a number" },
      { ...coca, isin: "F", sourceCountry: "KY" },
      { ...coca, isin: "G", country: "SI", id: " 1234 5678 " },
      { ...coca, isin: "H", name: "Coca\u200b-Cola\u202e\tCompany" },
    ]);
    // A Slovenian payer without its tax number is one Doh-Div still needs.
    expect([...payers.keys()]).toEqual([
      "US1912161007",
      "C",
      "D",
      "F",
      "G",
      "H",
    ]);
    expect(payers.get("C")?.identificationNumber).toBe("58-0628465");
    expect(payers.get("D")).toMatchObject({ taxNumber: "12345678" });
    expect(payers.get("G")).toMatchObject({ taxNumber: "12345678" });
    // Pasted characters the writer would refuse are gone.
    expect(payers.get("H")?.name).toBe("Coca -Cola Company");
    expect(payers.get("F")?.sourceCountry).toBe("KY");
  });
});
