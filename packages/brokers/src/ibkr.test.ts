/**
 * The Interactive Brokers adapter against a synthetic two-account statement
 * (test/fixtures/ibkr/README.md), and against one small statement per
 * thing it must refuse.
 */
import { readFileSync } from "node:fs";

import {
  fileIdOf,
  forExport,
  matchFifo,
  validateLedger,
  type LedgerEvent,
} from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { importFile, type ImportResult } from "./adapter.js";

const FIXTURE = readFileSync(
  new URL("../test/fixtures/ibkr/flex-activity-2025-2026.xml", import.meta.url),
  "utf8",
);

function read(text: string): ImportResult {
  const bytes = new TextEncoder().encode(text);
  return importFile({ bytes, fileId: fileIdOf(bytes), accountGroup: 1 });
}

const kinds = (events: readonly LedgerEvent[]) =>
  events.map((e) => (e.kind === "ignored" ? `ignored:${e.reason}` : e.kind));

const blocking = (result: ImportResult) =>
  result.diagnostics
    .filter((d) => d.severity === "blocking")
    .map((d) => d.code);

/** One statement for U16000009 over 2026, holding `body`. */
function statement(body: string, account = "U16000009"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="q" type="AF"><FlexStatements count="1">
<FlexStatement accountId="${account}" fromDate="20260101" toDate="20261231" period="" whenGenerated="20270105;101500">
<AccountInformation accountId="${account}" currency="EUR" ibEntity="IB-IE" />
${body}
</FlexStatement></FlexStatements></FlexQueryResponse>`;
}

/** A Trade execution row; attributes override the defaults. */
function trade(overrides: Record<string, string> = {}): string {
  const attributes: Record<string, string> = {
    currency: "USD",
    assetCategory: "STK",
    symbol: "AAPL",
    description: "APPLE INC",
    cusip: "037833100",
    isin: "US0378331005",
    multiplier: "1",
    tradeDate: "20260210",
    transactionType: "ExchTrade",
    quantity: "10",
    tradePrice: "150",
    tradeMoney: "1500",
    openCloseIndicator: "O",
    buySell: "BUY",
    transactionID: "800000001",
    levelOfDetail: "EXECUTION",
    ...overrides,
  };
  const pairs = Object.entries(attributes).map(([k, v]) => `${k}="${v}"`);
  return `<Trades><Trade ${pairs.join(" ")} /></Trades>`;
}

/** A CashTransaction row. */
function cash(overrides: Record<string, string>): string {
  const attributes: Record<string, string> = {
    currency: "USD",
    symbol: "KO",
    conid: "8894",
    isin: "US1912161007",
    description:
      "KO(US1912161007) CASH DIVIDEND USD 0.53 PER SHARE (Ordinary Dividend)",
    dateTime: "20260401;202000",
    amount: "15.9",
    type: "Dividends",
    transactionID: "800000101",
    levelOfDetail: "DETAIL",
    ...overrides,
  };
  const pairs = Object.entries(attributes).map(([k, v]) => `${k}="${v}"`);
  return `<CashTransaction ${pairs.join(" ")} />`;
}

describe("the synthetic two-account statement", () => {
  const result = read(FIXTURE);

  it("is recognized, and every record is accounted for", () => {
    expect(result.format).toBe("ibkr-flex-xml");
    expect(blocking(result)).toEqual([]);
    expect(kinds(result.events)).toEqual([
      // U16000001, 2025
      "trade",
      "ignored:summary",
      "trade",
      "ignored:currencyConversion",
      "ignored:summary",
      "ignored:deposit",
      "ignored:interest",
      "dividend",
      "withholding",
      // U16000002, 2026
      "ignored:securitiesTransfer",
      "trade",
      "ignored:summary",
      "ignored:derivative",
      "ignored:withdrawal",
      "ignored:reversed",
      "ignored:reversed",
      "ignored:reversed",
      "ignored:reversed",
      "dividend",
      "withholding",
      "dividend",
      "withholding",
      "split",
    ]);
    // Every Trades, CashTransactions, CorporateActions and Transfers record.
    const sources = new Set(
      result.events.map(
        (e) => `${e.source.part ?? ""} ${String(e.source.row)}`,
      ),
    );
    expect(sources.size).toBe(result.events.length);
    expect(sources.size).toBe(7 + 14 + 1 + 1);
  });

  it("says what it leaves for returns it does not build", () => {
    expect(
      result.diagnostics.map((d) => [d.severity, d.code, d.params]),
    ).toEqual([
      ["warning", "interestNotCovered", { broker: "ibkr", count: 1 }],
      ["warning", "derivativesNotCovered", { broker: "ibkr", count: 1 }],
    ]);
  });

  it("reads trades at the contract price, each in its own account, dated as IBKR dates them", () => {
    const trades = result.events.filter((e) => e.kind === "trade");
    expect(
      trades.map((t) => [
        t.side,
        t.date,
        t.at.instant,
        t.security.isin,
        t.security.isFund === true,
        t.quantity.toString(),
        t.price.amount.toString(),
        t.price.currency,
      ]),
    ).toEqual([
      ["buy", "2025-03-03", null, "US0378331005", false, "10", "150.1", "USD"],
      ["buy", "2025-06-02", null, "IE00BK5BQT80", true, "5", "120", "EUR"],
      ["sell", "2026-02-10", null, "US0378331005", false, "4", "230", "USD"],
    ]);
    const [first, , third] = trades;
    expect(first?.account).not.toBe(third?.account);
    expect(first?.account).toMatch(/^ibkr:[0-9a-f]{32}$/);
  });

  it("never reads IBKR's own rates, cost or P&L", () => {
    const altered = FIXTURE.replaceAll(
      /fxRateToBase="[^"]*"/g,
      'fxRateToBase="9"',
    )
      .replaceAll(/cost="[^"]*"/g, 'cost="1"')
      .replaceAll(/fifoPnlRealized="[^"]*"/g, 'fifoPnlRealized="0"');
    // The file's ID changes with its bytes; nothing else may.
    const content = (r: ImportResult) =>
      r.events.map((e) => ({ ...e, source: { ...e.source, fileId: "" } }));
    expect(content(read(altered))).toEqual(content(read(FIXTURE)));
  });

  it("joins each tax to its dividend, and sets a reversed one aside with its tax", () => {
    const paid = result.events.filter((e) => e.kind === "dividend");
    const taxes = result.events.filter((e) => e.kind === "withholding");
    expect(
      paid.map((d) => [d.date, d.gross.amount.toString(), d.gross.currency]),
    ).toEqual([
      ["2025-04-01", "15.9", "USD"],
      ["2026-04-01", "15.9", "USD"],
      ["2026-07-03", "16.05", "USD"],
    ]);
    expect(taxes.map((t) => [t.date, t.amount.amount.toString()])).toEqual([
      ["2025-04-01", "2.39"],
      ["2026-04-01", "2.39"],
      ["2026-07-03", "2.41"],
    ]);
    expect(taxes.map((t) => t.dividendKey)).toEqual(paid.map((d) => d.key));
  });

  it("reaches each account's statement end", () => {
    expect(result.reach.map((r) => r.lastDate).sort()).toEqual([
      "2025-12-31",
      "2026-12-31",
    ]);
  });

  it("feeds FIFO across both accounts, the split checked against the shares", () => {
    const ledger = validateLedger(result.events, result.diagnostics);
    expect(ledger.diagnostics.filter((d) => d.severity === "blocking")).toEqual(
      [],
    );
    const fifo = matchFifo(ledger);
    expect(fifo.diagnostics).toEqual([]);
    const apple = fifo.securities.get("US0378331005");
    expect(
      apple?.disposals[0]?.matches.map((m) => m.quantity.toString()),
    ).toEqual(["4"]);
    // 6 left, 2 for 1 in May: 12.
    expect(apple?.open.map((lot) => lot.quantity.toString())).toEqual(["12"]);
  });

  it("gives the same events whatever order its statements are in", () => {
    const [head, rest] = FIXTURE.split('<FlexStatements count="2">\n') as [
      string,
      string,
    ];
    const [one, two] = rest.split(
      /(?=<FlexStatement accountId="U16000002")/,
    ) as [string, string];
    const tail = "</FlexStatements>";
    const swapped = `${head}<FlexStatements count="2">\n${two.replace(/<\/FlexStatements>[^]*$/, "")}${one}${tail}\n</FlexQueryResponse>\n`;
    const byKey = (r: ImportResult) =>
      r.events.flatMap((e) => (e.kind === "ignored" ? [] : [e.key])).sort();
    expect(byKey(read(swapped))).toEqual(byKey(result));
  });

  it("keeps account numbers, IDs and cash descriptions out of everything that leaves", () => {
    const out = JSON.stringify([
      result.events.map((e) => (e.kind === "ignored" ? e.reason : e.key)),
      result.events.map((e) => e.account),
      result.diagnostics.map(forExport),
    ]);
    expect(out).not.toMatch(/U1600000|7000002|CANARY|IBAN/);
  });
});

describe("statements it refuses rather than guesses", () => {
  it("anything but plain XML elements", () => {
    const result = read(
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><FlexQueryResponse type="AF"/>',
    );
    expect(result.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["unreadableFile", { reason: "doctype", row: 1 }],
    ]);
    expect(result.events).toEqual([]);
  });

  it("another kind of Flex query, or another XML file", () => {
    expect(blocking(read('<FlexQueryResponse type="TCF"/>'))).toEqual([
      "unknownFormat",
    ]);
    expect(blocking(read("<Statement/>"))).toEqual(["unknownFormat"]);
  });

  it("a section it does not know, but skips one that only summarizes", () => {
    expect(
      blocking(read(statement('<NewSection><Row a="1"/></NewSection>'))),
    ).toEqual(["unknownElement"]);
    // Names every object inherits are sections like any other unknown one.
    for (const name of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(
        blocking(read(statement(`<${name}><Trade a="1"/></${name}>`))),
        name,
      ).toEqual(["unknownElement"]);
    }
    expect(
      blocking(
        read(
          statement('<CashReport><CashReportCurrency total="1"/></CashReport>'),
        ),
      ),
    ).toEqual([]);
  });

  it("paper accounts, malformed account IDs, a row of another account, too many accounts", () => {
    expect(blocking(read(statement("", "DU1234567")))).toEqual([
      "paperAccount",
    ]);
    expect(blocking(read(statement("", "X1")))).toEqual(["accountIdInvalid"]);
    expect(
      blocking(read(statement(trade({ accountId: "U16000008" })))),
    ).toEqual(["accountMismatch"]);
    const many = Array.from(
      { length: 11 },
      (_, i) =>
        `<FlexStatement accountId="U1600010${String(i).padStart(2, "0")}" fromDate="20260101" toDate="20261231" whenGenerated="20270105"></FlexStatement>`,
    ).join("");
    expect(
      blocking(
        read(
          `<FlexQueryResponse type="AF"><FlexStatements count="11">${many}</FlexStatements></FlexQueryResponse>`,
        ),
      ),
    ).toEqual(["tooManyAccounts"]);
  });

  it("a count that disagrees, dates in another format, an impossible period", () => {
    expect(
      blocking(read(statement("").replace('count="1"', 'count="2"'))),
    ).toEqual(["statementCountMismatch"]);
    expect(
      blocking(
        read(
          statement("").replace('fromDate="20260101"', 'fromDate="01/01/2026"'),
        ),
      ),
    ).toEqual(["unsupportedDateFormat"]);
    expect(
      blocking(
        read(statement("").replace('toDate="20261231"', 'toDate="20251231"')),
      ),
    ).toEqual(["statementPeriodInvalid"]);
    expect(blocking(read(statement(trade({ tradeDate: "20270201" }))))).toEqual(
      ["rowAfterStatement"],
    );
  });

  it("a statement of orders or summaries only", () => {
    expect(
      blocking(
        read(statement(trade({ levelOfDetail: "ORDER", transactionID: "" }))),
      ),
    ).toEqual(["summaryOnly"]);
    expect(
      blocking(
        read(
          statement(
            `<CashTransactions>${cash({ levelOfDetail: "SUMMARY", transactionID: "" })}</CashTransactions>`,
          ),
        ),
      ),
    ).toEqual(["summaryOnly"]);
  });

  it("trades that amend or move positions, short sales, and trades that do not add up", () => {
    const cases: [Record<string, string>, string][] = [
      [{ transactionType: "TradeCancel" }, "unsupportedAction"],
      [{ transactionType: "BookTrade" }, "unsupportedAction"],
      [{ notes: "Ex" }, "unsupportedAction"],
      [
        { buySell: "SELL", quantity: "-10", tradeMoney: "-1500" },
        "unsupportedAction",
      ],
      [{ openCloseIndicator: "C;O" }, "unsupportedAction"],
      [{ quantity: "-10" }, "tradeInconsistent"],
      [{ multiplier: "100" }, "tradeInconsistent"],
      [{ tradeMoney: "1400" }, "tradeInconsistent"],
      [{ cusip: "000000000" }, "tradeInconsistent"],
      [{ quantity: "1e3" }, "invalidNumber"],
      [{ assetCategory: "BOND" }, "unsupportedAction"],
      [{ assetCategory: "WEIRD" }, "unknownAction"],
      [{ levelOfDetail: "LOT" }, "unknownDetailLevel"],
    ];
    for (const [overrides, code] of cases) {
      expect(
        blocking(read(statement(trade(overrides)))),
        JSON.stringify(overrides),
      ).toEqual([code]);
    }
  });

  it("payments in lieu, distributions that are not dividends, and tax it cannot join", () => {
    const rows = (...items: string[]) =>
      statement(`<CashTransactions>${items.join("")}</CashTransactions>`);
    expect(
      blocking(read(rows(cash({ type: "Payment In Lieu Of Dividends" })))),
    ).toEqual(["unsupportedAction"]);
    expect(
      blocking(
        read(
          rows(
            cash({
              description: "KO(US1912161007) DISTRIBUTION (Return of Capital)",
            }),
          ),
        ),
      ),
    ).toEqual(["unsupportedAction"]);
    const tax = cash({
      type: "Withholding Tax",
      amount: "-2.39",
      transactionID: "800000102",
      description: "KO(US1912161007) - US TAX",
    });
    expect(blocking(read(rows(tax)))).toEqual(["withholdingUnlinked"]);
    expect(
      blocking(
        read(
          rows(
            cash({}),
            cash({ transactionID: "800000103", amount: "1.1" }),
            tax,
          ),
        ),
      ),
    ).toEqual(["withholdingAmbiguous"]);
    expect(
      blocking(
        read(rows(cash({ amount: "-15.9", transactionID: "800000104" }))),
      ),
    ).toEqual(["dividendReversalUnmatched"]);
  });

  it("corporate actions other than a split that keeps its ISIN", () => {
    const action = (attrs: string) =>
      statement(
        `<CorporateActions><CorporateAction ${attrs} /></CorporateActions>`,
      );
    expect(
      blocking(read(action('type="SO" isin="US0378331005" actionID="1"'))),
    ).toEqual(["unsupportedAction"]);
    const leg = (isin: string, quantity: string) =>
      `<CorporateAction isin="${isin}" description="ACME(US00000ACME1) SPLIT 1 FOR 10 (ACME, ACME CORP, ${isin})" dateTime="20260519;202500" quantity="${quantity}" type="RS" actionID="2" />`;
    expect(
      blocking(
        read(
          statement(
            `<CorporateActions>${leg("US00000ACMN2", "5")}${leg("US00000ACME1", "-50")}</CorporateActions>`,
          ),
        ),
      ),
    ).toEqual(["unsupportedAction", "unsupportedAction"]);
  });

  it("a transaction listed twice in one file, as a repeat", () => {
    const twice = statement(`${trade()}${trade()}`);
    const result = read(twice);
    expect(blocking(result)).toEqual([]);
    const ledger = validateLedger(result.events, result.diagnostics);
    expect(ledger.diagnostics.map((d) => d.code)).toEqual([
      "duplicateKeyInFile",
    ]);
  });
});
