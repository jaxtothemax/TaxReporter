/**
 * The one door into the engine (ADR 0011): what it refuses, what it merges,
 * and the overlapping files it reconciles.
 */
import { describe, expect, it } from "vitest";

import { account, fileId, ISIN, key, split, trade } from "../test/events.js";
import { Decimal } from "./decimal.js";
import { diagnostic, untrusted } from "./diagnostics.js";
import type {
  AccountScope,
  DividendEvent,
  IgnoredRow,
  LedgerEvent,
  TradeEvent,
  WithholdingEvent,
} from "./ledger.js";
import { LIMITS } from "./limits.js";
import { eventId, validateLedger } from "./validate.js";

const codes = (events: readonly LedgerEvent[]) =>
  validateLedger(events).diagnostics.map((d) => d.code);

/** Read from file `file`, at `row`. */
const at = (file: string, row: number) => ({
  source: { fileId: fileId(file), row },
});

/** The same trade, read again from another file. */
const from = (event: TradeEvent, file: string, row = 1): TradeEvent => ({
  ...event,
  ...at(file, row),
});

function dividend(
  date: string,
  overrides: Partial<DividendEvent> = {},
): DividendEvent {
  return {
    kind: "dividend",
    key: key(`d${date}`),
    broker: "ibkr",
    account: account("ibkr"),
    source: { fileId: fileId("ibkr"), row: 900 },
    at: { instant: null, brokerDate: date },
    date,
    security: { isin: ISIN },
    gross: { amount: Decimal.parse("1.50"), currency: "USD" },
    ...overrides,
  };
}

const ignored: IgnoredRow = {
  kind: "ignored",
  reason: "deposit",
  broker: "ibkr",
  account: account("ibkr"),
  source: { fileId: fileId("ibkr"), row: 1 },
};

describe("validateLedger", () => {
  it("passes good events through in file and row order, and freezes them", () => {
    const buy = trade("buy", "2025-01-02", "10");
    const sale = trade("sell", "2025-03-04", "5");
    const { events: ledger, diagnostics } = validateLedger([
      sale,
      ignored,
      buy,
    ]);
    expect(diagnostics).toEqual([]);
    expect(ledger).toEqual([ignored, buy, sale]);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(validateLedger([buy]))).toBe(true);
  });

  it("refuses events it cannot trust, without repeating what they say", () => {
    const bad = (overrides: Record<string, unknown>) =>
      ({ ...trade("buy", "2025-01-02", "1"), ...overrides }) as never;
    const { events: ledger, diagnostics } = validateLedger([
      bad({ date: "2025-1-2" }),
      bad({ security: { isin: "us0378331005" } }),
      bad({ side: "BUY" }),
      bad({ price: { amount: Decimal.parse("-1"), currency: "USD" } }),
      bad({ price: { amount: Decimal.parse("1"), currency: "U1234567" } }),
      bad({ security: { isin: ISIN, name: 42 } }),
      bad({ commission: { amount: 1, currency: "USD" } }),
      { ...trade("buy", "2025-01-02", "1"), kind: "spinoff" } as never,
      { ...split("2025-06-10", "2", "3"), to: Decimal.parse("1.5") },
      {
        ...split("2025-06-10", "1", "2"),
        to: Decimal.fromInteger(LIMITS.splitTerm + 1),
      },
    ]);
    expect(ledger).toEqual([]);
    expect(diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["invalidTrade", { isin: ISIN }],
      ["invalidTrade", { date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["invalidTrade", { isin: ISIN, date: "2025-01-02" }],
      ["unknownEvent", {}],
      ["invalidSplit", { isin: ISIN, date: "2025-06-10" }],
      ["invalidSplit", { isin: ISIN, date: "2025-06-10" }],
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("U1234567");
  });

  it("refuses an event whose source, account, key or clock breaks the contract", () => {
    const good = trade("buy", "2025-01-02", "1");
    const broken = [
      { ...good, source: { fileId: "Janez_Novak_U1234567.csv", row: 1 } },
      { ...good, source: { ...good.source, row: 0 } },
      { ...good, source: { ...good.source, part: "../Janez" } },
      { ...good, account: account("trading212") },
      { ...good, account: "ibkr:U1234567" },
      { ...good, account: "ibkr:a:b" },
      { ...good, key: "EOF1234567" },
      { ...good, at: { instant: null, brokerDate: "2025-01-03" } },
      { ...good, at: { instant: "2025-01-02T10:00:00", brokerDate: null } },
      { ...good, at: { instant: null, brokerDate: null } },
      { ...good, at: undefined },
    ] as never[];
    for (const event of broken) {
      const { events: ledger, diagnostics } = validateLedger([event]);
      expect(ledger, JSON.stringify(event)).toEqual([]);
      expect(diagnostics.map((d) => d.code)).toEqual(["invalidTrade"]);
      expect(JSON.stringify(diagnostics)).not.toMatch(/Janez|U1234567|EOF/);
    }
  });

  it("refuses a number that only borrows the Decimal prototype", () => {
    const fake = Object.create(Decimal.prototype) as Decimal;
    const bad = { ...trade("buy", "2025-01-02", "1"), quantity: fake };
    expect(codes([bad])).toEqual(["invalidTrade"]);
  });

  it("freezes every event it passes, down to its parts", () => {
    const buy = trade("buy", "2025-01-02", "10");
    validateLedger([buy]);
    expect(Object.isFrozen(buy)).toBe(true);
    expect(Object.isFrozen(buy.price)).toBe(true);
    expect(Object.isFrozen(buy.source)).toBe(true);
    expect(Object.isFrozen(buy.at)).toBe(true);
  });

  it("dates every event by the one date policy", () => {
    // 23:30 UTC on New Year's Day is half past midnight in Ljubljana.
    const night = trade("sell", "2025-01-02", "1", "100", {
      broker: "trading212",
      at: { instant: "2025-01-01T23:30:00Z", brokerDate: "2025-01-01" },
    });
    expect(codes([night])).toEqual([]);
    expect(codes([{ ...night, date: "2025-01-01" }])).toEqual(["invalidTrade"]);
  });

  it("takes a split's reported share change only as a nonzero Decimal", () => {
    const base = split("2025-06-10", "1", "4");
    expect(codes([{ ...base, positionChange: Decimal.parse("30") }])).toEqual(
      [],
    );
    expect(codes([{ ...base, positionChange: Decimal.ZERO }])).toEqual([
      "invalidSplit",
    ]);
    expect(codes([{ ...base, positionChange: 30 } as never])).toEqual([
      "invalidSplit",
    ]);
  });

  it("refuses a trade of no shares, and a split with a zero term", () => {
    expect(
      codes([
        trade("buy", "2025-07-02", "0"),
        trade("buy", "2025-07-03", "-1"),
        split("2025-06-02", "0", "2"),
      ]),
    ).toEqual(["invalidTrade", "invalidTrade", "invalidSplit"]);
  });

  it("checks dividends and the tax withheld on them", () => {
    const paid = dividend("2025-03-10");
    const withheld: WithholdingEvent = {
      kind: "withholding",
      key: key("w1"),
      broker: "ibkr",
      account: account("ibkr"),
      source: paid.source,
      at: paid.at,
      date: paid.date,
      isin: ISIN,
      dividendKey: paid.key,
      amount: { amount: Decimal.parse("-0.23"), currency: "USD" },
    };
    expect(codes([paid, withheld])).toEqual([]);
    expect(
      codes([{ ...paid, gross: { amount: Decimal.ONE, currency: "usd" } }]),
    ).toEqual(["invalidDividend"]);
    expect(codes([{ ...paid, security: { isin: "XX" } }])).toEqual([
      "invalidDividend",
    ]);
    const loose = (overrides: Record<string, unknown>) =>
      ({ ...paid, ...overrides }) as never;
    const refused = validateLedger([
      loose({ date: "2025-3-10" }),
      loose({ gross: { amount: 10, currency: "USD" } }),
      loose({ gross: { amount: Decimal.ONE, currency: "U1234567" } }),
    ]).diagnostics;
    // One row's findings, ordered by what they say.
    expect(refused.map((d) => [d.code, d.params])).toEqual([
      ["invalidDividend", { isin: ISIN, date: "2025-03-10" }],
      ["invalidDividend", { isin: ISIN, date: "2025-03-10" }],
      ["invalidDividend", { isin: ISIN }],
    ]);
    expect(JSON.stringify(refused)).not.toContain("U1234567");
    expect(
      codes([{ ...withheld, dividendKey: "dividend-1" } as never]),
    ).toEqual(["invalidWithholding"]);
    expect(codes([{ ...withheld, isin: "XX" }])).toEqual([
      "invalidWithholding",
    ]);
  });

  it("keeps ignored rows, and refuses one without a known reason", () => {
    expect(validateLedger([ignored]).events).toEqual([ignored]);
    expect(codes([{ ...ignored, reason: "other" } as never])).toEqual([
      "unknownEvent",
    ]);
    // A label is a group number or a hashed ID, never an account number.
    for (const label of ["B", "u1234567", "0", "101", "main"]) {
      const scope = `ibkr:${label}` as AccountScope;
      expect(codes([{ ...ignored, account: scope }]), label).toEqual([
        "unknownEvent",
      ]);
    }
    const hashed = `ibkr:${"0123456789abcdef".repeat(2)}` as AccountScope;
    expect(codes([{ ...ignored, account: hashed }])).toEqual([]);
    expect(codes([{ ...ignored, account: account("ibkr", 100) }])).toEqual([]);
  });

  it("drops events read twice from overlapping exports, and says so", () => {
    const buy = trade("buy", "2025-01-02", "10");
    const sale = trade("sell", "2026-03-01", "10");
    const { events: ledger, diagnostics } = validateLedger([
      from(buy, "other"),
      sale,
      buy,
    ]);
    expect(ledger).toEqual([buy, sale]);
    expect(diagnostics).toEqual([
      { severity: "info", code: "duplicatesRemoved", params: { count: 1 } },
    ]);
  });

  it("refuses a key repeated in one file, or reported twice with other content", () => {
    const buy = trade("buy", "2025-01-02", "10");
    expect(
      codes([buy, { ...buy, source: { ...buy.source, row: 99 } }]),
    ).toEqual(["duplicateKeyInFile"]);
    expect(
      codes([buy, { ...from(buy, "b"), quantity: Decimal.parse("20") }]),
    ).toEqual(["duplicateKeyConflict"]);
    // The same key in another account is never merged as a repeat; at one
    // broker it says the two are one account, checked below.
    const other = { ...buy, account: account("ibkr", 2) };
    expect(eventId(buy)).not.toBe(eventId(other));
    expect(validateLedger([buy, other]).events).toHaveLength(2);
  });

  it("keeps the report read first by file and row, whatever the order", () => {
    const a = trade("buy", "2025-01-02", "10", "100", {
      key: key("same"),
      security: { isin: ISIN, name: "Apple Inc" },
      ...at("a", 5),
    });
    const b = {
      ...from(a, "b", 2),
      security: { isin: ISIN, name: "APPLE INC." },
    };
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const { events: ledger, diagnostics } = validateLedger(order);
      expect(ledger).toEqual([a]);
      expect(diagnostics.map((d) => d.code)).toEqual(["duplicatesRemoved"]);
    }
  });

  it("blocks a key repeated inside any one file, not only the first", () => {
    const a = trade("buy", "2025-01-02", "10", "100", {
      key: key("k"),
      ...at("a", 1),
    });
    const { diagnostics } = validateLedger([
      a,
      from(a, "b", 1),
      from(a, "b", 2),
    ]);
    expect(diagnostics.map((d) => [d.code, d.source])).toEqual([
      ["duplicatesRemoved", undefined],
      ["duplicateKeyInFile", { fileId: fileId("b"), row: 2 }],
    ]);
  });

  it("gives one ledger and one list of findings whatever order files come in", () => {
    const events: LedgerEvent[] = [
      trade("buy", "2025-02-03", "10", "100", at("a", 2)),
      trade("sell", "2025-02-05", "1", "100", at("a", 3)),
      trade("buy", "2025-02-04", "1", "100", at("b", 1)),
      { ...trade("buy", "2025-02-04", "1"), side: "BUY" } as never,
      { ...ignored, ...at("b", 2) },
      dividend("2025-02-04", at("a", 1)),
    ];
    const summary = (input: LedgerEvent[]) =>
      JSON.stringify(validateLedger(input));
    const expected = summary(events);
    expect(expected).toContain("overlapKindMissing");
    for (const order of [
      [5, 4, 3, 2, 1, 0],
      [2, 0, 4, 1, 5, 3],
      [3, 5, 1, 4, 0, 2],
    ]) {
      expect(summary(order.map((i) => events[i] as LedgerEvent))).toBe(
        expected,
      );
    }
  });
});

describe("validateLedger's reconciliation of overlapping files", () => {
  it("blocks two files of one account that disagree while both recorded", () => {
    const january = trade("buy", "2025-01-05", "1", "100", at("a", 1));
    const february = trade("buy", "2025-02-03", "1", "100", at("a", 2));
    const march = trade("buy", "2025-03-01", "1", "100", at("a", 3));
    // File b covers 3 to 10 February and holds a purchase file a lacks.
    const only = trade("buy", "2025-02-10", "1", "100", at("b", 2));
    const { diagnostics } = validateLedger([
      january,
      february,
      march,
      from(february, "b", 1),
      only,
    ]);
    expect(diagnostics).toEqual([
      { severity: "info", code: "duplicatesRemoved", params: { count: 1 } },
      {
        severity: "blocking",
        code: "overlapMismatch",
        params: {
          kind: "trade",
          from: "2025-02-03",
          to: "2025-02-10",
          first: { file: fileId("a") },
          second: { file: fileId("b") },
        },
      },
    ]);
  });

  it("warns when one file of an account has none of a kind the other holds", () => {
    const buy = trade("buy", "2025-03-01", "1", "100", at("a", 1));
    const paid = dividend("2025-03-10", at("a", 2));
    const sale = trade("sell", "2025-03-20", "1", "100", at("a", 3));
    // File b: the same trades, exported without dividends.
    const { diagnostics } = validateLedger([
      buy,
      paid,
      sale,
      from(buy, "b", 1),
      from(sale, "b", 2),
    ]);
    expect(diagnostics).toEqual([
      { severity: "info", code: "duplicatesRemoved", params: { count: 2 } },
      {
        severity: "warning",
        code: "overlapKindMissing",
        params: {
          kind: "dividend",
          from: "2025-03-01",
          to: "2025-03-20",
          first: { file: fileId("a") },
          second: { file: fileId("b") },
        },
      },
    ]);
  });

  it("compares on the broker's clock, to the second", () => {
    const instant = (time: string) => ({
      broker: "trading212",
      at: { instant: `2025-03-01T${time}Z`, brokerDate: null },
    });
    // File b starts at 12:00, after file a's morning purchase: no conflict.
    const morning = trade("buy", "2025-03-01", "1", "100", {
      ...instant("09:00:00"),
      ...at("a", 1),
    });
    const noon = trade("buy", "2025-03-01", "1", "100", {
      ...instant("12:00:00"),
      ...at("a", 2),
    });
    const evening = trade("buy", "2025-03-01", "1", "100", {
      ...instant("18:00:00"),
      ...at("b", 2),
    });
    expect(codes([morning, noon, from(noon, "b", 1), evening])).toEqual([
      "duplicatesRemoved",
    ]);
  });

  it("never compares two accounts, nor files of one account that do not overlap", () => {
    expect(
      codes([
        trade("buy", "2025-02-03", "1", "100", at("a", 1)),
        trade("buy", "2025-02-04", "1", "100", {
          account: account("ibkr", 2),
          ...at("b", 1),
        }),
        trade("buy", "2025-02-05", "1", "100", at("a", 2)),
      ]),
    ).toEqual([]);
    expect(
      codes([
        trade("buy", "2024-02-03", "1", "100", at("a", 1)),
        trade("buy", "2025-02-04", "1", "100", at("b", 1)),
      ]),
    ).toEqual([]);
  });
});

describe("validateLedger's check of accounts", () => {
  it("blocks two accounts of one broker that hold the same trade", () => {
    // One account's export, taken as two accounts: every trade would count twice.
    const buy = trade("buy", "2025-02-03", "1", "100", at("a", 1));
    const sale = trade("sell", "2025-03-03", "1", "100", at("a", 2));
    const twin = (event: TradeEvent, row: number) => ({
      ...from(event, "b", row),
      account: account("ibkr", 2),
    });
    const { diagnostics } = validateLedger([
      buy,
      sale,
      twin(buy, 1),
      twin(sale, 2),
    ]);
    expect(diagnostics).toEqual([
      {
        severity: "blocking",
        code: "accountsShareEvents",
        params: {
          kind: "trade",
          count: 2,
          first: { file: fileId("a") },
          second: { file: fileId("b") },
        },
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("ibkr:");
  });

  it("warns of a dividend two accounts share, and lets a shared split be", () => {
    const paid = dividend("2025-03-10", at("a", 1));
    const other = {
      ...paid,
      ...at("b", 1),
      account: account("ibkr", 2),
    };
    expect(codes([paid, other])).toEqual(["accountsShareEvents"]);
    expect(validateLedger([paid, other]).diagnostics[0]?.severity).toBe(
      "warning",
    );
    const split1 = split("2025-06-10", "1", "4");
    const split2 = {
      ...split1,
      account: account("ibkr", 2),
      source: { fileId: fileId("b"), row: 1 },
    };
    expect(codes([split1, split2])).toEqual([]);
  });

  it("never compares two brokers' keys", () => {
    const buy = trade("buy", "2025-02-03", "1", "100", at("a", 1));
    const other = {
      ...from(buy, "b", 1),
      broker: "trading212",
      account: account("trading212"),
    };
    expect(codes([buy, other])).toEqual([]);
  });
});

describe("validateLedger's carried findings", () => {
  it("keeps what reading the files found, in place order and each once", () => {
    const buy = trade("buy", "2025-01-02", "10");
    const refusedRow = diagnostic(
      "blocking",
      "unknownAction",
      { broker: "ibkr", action: untrusted("Gift card") },
      { fileId: fileId("a"), row: 7 },
    );
    const note = diagnostic("info", "fundFromName", { isin: ISIN });
    const ledger = validateLedger([buy], [refusedRow, note, note]);
    expect(ledger.events).toEqual([buy]);
    expect(ledger.diagnostics).toEqual([note, refusedRow]);
  });
});

describe("validateLedger's limit", () => {
  it("takes as many events as a session may hold, and refuses one more", () => {
    const full = new Array<LedgerEvent>(LIMITS.eventsPerSession).fill(ignored);
    expect(validateLedger(full).diagnostics).toEqual([]);
    const over = validateLedger([...full, ignored]);
    expect(over.events).toEqual([]);
    expect(over.diagnostics).toEqual([
      {
        severity: "blocking",
        code: "tooManyEvents",
        params: { limit: LIMITS.eventsPerSession },
      },
    ]);
  });
});
