/**
 * The mapper's own rules, on small inputs: how many findings a reply
 * carries, and what of a file's text the screen may show.
 */
import {
  Decimal,
  type AccountScope,
  type DividendEvent,
  type EventKey,
  type FileId,
  type LedgerEvent,
} from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import type { Finding } from "../model/preview";
import { bounded, MAX_FINDINGS, payerPrompts, symbolsOf } from "./toPreview";

const finding = (severity: Finding["severity"], row: number): Finding => ({
  severity,
  code: "duplicateKeyInFile",
  params: {},
  source: { file: 0, row },
});

describe("bounded", () => {
  it("sends every finding of an ordinary session", () => {
    const few = [finding("info", 1), finding("blocking", 2)];
    expect(bounded(few)).toEqual({ findings: few, omitted: 0 });
  });

  it("keeps the blocking ones first when a file raises too many", () => {
    // One repeated row, a hundred thousand times over, and two real problems.
    const flood = Array.from({ length: 100_000 }, (_, i) => finding("info", i));
    const all = [
      ...flood.slice(0, 50_000),
      finding("blocking", -1),
      ...flood.slice(50_000),
      finding("warning", -2),
    ];
    const { findings, omitted } = bounded(all);
    expect(findings).toHaveLength(MAX_FINDINGS);
    expect(omitted).toBe(all.length - MAX_FINDINGS);
    // Both kept, in the order they came, among the first notes.
    expect(findings.filter((f) => f.severity !== "info")).toEqual([
      finding("blocking", -1),
      finding("warning", -2),
    ]);
    expect(findings[0]).toEqual(finding("info", 0));
  });
});

const dividend = (
  isin: string,
  symbol: string,
  name: string,
): DividendEvent => ({
  kind: "dividend",
  key: "0".repeat(32) as EventKey,
  broker: "trading212",
  account: "trading212:1" as AccountScope,
  source: { fileId: "0123456789abcdef" as FileId, row: 2 },
  at: { instant: null, brokerDate: "2026-04-01" },
  date: "2026-04-01",
  security: { isin, symbol, name },
  gross: { amount: Decimal.parse("1"), currency: "USD" },
});

describe("symbolsOf and payerPrompts", () => {
  const events: LedgerEvent[] = [
    dividend("US1912161007", "KO\u202e", "Coca\u200b-Cola\u2028Company"),
    dividend("US0378331005", "MSFT (US5949181045)", "Apple"),
  ];

  it("show a ticker cleaned, and none that could pass for something else", () => {
    expect(symbolsOf(events)).toEqual({ US1912161007: "KO" });
  });

  it("preset payers with names cleaned of what displays as something else", () => {
    expect(
      payerPrompts(events, 2026).map((p) => [p.isin, p.symbol, p.name]),
    ).toEqual([
      // By ticker, or by ISIN where there is none to show.
      ["US1912161007", "KO", "Coca -Cola Company"],
      ["US0378331005", "", "Apple"],
    ]);
  });

  it("name the broker that paid, or none when several did", () => {
    const paid = (broker: string) => ({
      ...dividend("US1912161007", "KO", "Coca-Cola"),
      broker,
    });
    const brokers = (...names: string[]) =>
      payerPrompts(names.map(paid), 2026).map((p) => p.broker);
    expect(brokers("trading212", "trading212")).toEqual(["trading212"]);
    // A mix is named by no broker, whichever order it comes in.
    expect(brokers("trading212", "ibkr")).toEqual([""]);
    expect(brokers("ibkr", "trading212", "trading212")).toEqual([""]);
  });
});
