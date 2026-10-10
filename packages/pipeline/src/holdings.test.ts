/**
 * The holdings beside the returns, over a made-up ledger of two accounts at
 * two brokers: the two views differ where a sale at one broker consumed a
 * lot bought at the other.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  accountGroup,
  accountScope,
  Decimal,
  diagnostic,
  fileIdOf,
  keyBuilder,
  validateLedger,
  type AccountScope,
  type Diagnostic,
  type FileId,
  type IsoDate,
  type KeyBuilder,
  type KeyedEvent,
  type LedgerEvent,
  type SecurityRef,
} from "@taxreporter/core";
import { RateTable } from "@taxreporter/fx";
import { describe, expect, it } from "vitest";

import { buildHoldings, type FileReach, type Holdings } from "./holdings.js";

const root = new URL("../../../", import.meta.url);
const data = (file: string) =>
  readFileSync(
    fileURLToPath(new URL(`packages/fx/data/${file}`, root)),
    "utf8",
  );
const rates = RateTable.fromCsv(
  data("bsi-daily.csv"),
  data("bsi-monthly.csv"),
  // Fixed, not the snapshot's own: a later snapshot must not change a lot
  // bought after this day from "no rate yet" into a cost.
  "2026-10-07",
);

const AAPL: SecurityRef = {
  isin: "US0378331005",
  symbol: "AAPL",
  name: "Apple Inc.",
};
const MSFT: SecurityRef = {
  isin: "US5949181045",
  symbol: "MSFT",
  name: "Microsoft Corp.",
};
const NVDA: SecurityRef = {
  isin: "US67066G1040",
  symbol: "NVDA",
  name: "NVIDIA Corp.",
};
const O: SecurityRef = {
  isin: "US7561091049",
  symbol: "O",
  name: "Realty Income Corp.",
};
const VWCE: SecurityRef = {
  isin: "IE00BK5BQT80",
  symbol: "VWCE",
  name: "Vanguard FTSE All-World UCITS ETF (Acc)",
  isFund: true,
};

interface File {
  readonly broker: string;
  readonly fileId: FileId;
  readonly account: AccountScope;
  readonly keys: KeyBuilder;
  row: number;
}

function file(broker: string, name: string, account: AccountScope): File {
  return {
    broker,
    fileId: fileIdOf(new TextEncoder().encode(name)),
    account,
    keys: keyBuilder(),
    row: 1,
  };
}

function next(
  f: File,
  kind: KeyedEvent["kind"],
  parts: string[],
  date: IsoDate,
) {
  f.row += 1;
  return {
    key: f.keys.key(kind, [...parts, date]),
    broker: f.broker,
    account: f.account,
    source: { fileId: f.fileId, row: f.row },
    at: { instant: null, brokerDate: date },
    date,
  };
}

const trade = (
  f: File,
  security: SecurityRef,
  side: "buy" | "sell",
  date: IsoDate,
  quantity: string,
  price: string,
  currency = "USD",
): LedgerEvent => ({
  kind: "trade",
  ...next(f, "trade", [side, security.isin, quantity, price], date),
  side,
  security,
  quantity: Decimal.parse(quantity),
  price: { amount: Decimal.parse(price), currency },
});

/** A made-up IBKR account ID: its scope must never leave the pipeline. */
const IBKR_ACCOUNT = "U7654321";

function session() {
  const ibkr = file("ibkr", "ibkr.xml", accountScope("ibkr", IBKR_ACCOUNT));
  const t212 = file("trading212", "t212.csv", accountGroup("trading212", 1));
  const events: LedgerEvent[] = [
    // AAPL: 10 at IBKR before the 4-for-1 split, 5 after; 10 at Trading 212.
    trade(ibkr, AAPL, "buy", "2019-08-14", "10", "201.72"),
    {
      kind: "split",
      ...next(ibkr, "split", [AAPL.isin, "1", "4"], "2020-08-31"),
      isin: AAPL.isin,
      from: Decimal.ONE,
      to: Decimal.parse("4"),
    },
    trade(t212, AAPL, "buy", "2021-01-04", "10", "129.41"),
    trade(ibkr, AAPL, "buy", "2025-03-03", "5", "238.03"),
    // Sold at Trading 212: FIFO takes it from IBKR's 2019 lot.
    trade(t212, AAPL, "sell", "2026-03-02", "8", "264.72"),
    // Held more than fifteen years.
    trade(ibkr, MSFT, "buy", "2010-03-01", "5", "28.80"),
    // Sold at Trading 212 with no purchase in any file.
    trade(t212, NVDA, "sell", "2026-05-04", "5", "198.89"),
    // In euro: no conversion.
    trade(t212, VWCE, "buy", "2026-06-15", "3", "141.20", "EUR"),
    // After IBKR's files end: in Trading 212's position, not in the lots,
    // which are as of the earlier day for a security both accounts hold.
    trade(t212, MSFT, "buy", "2026-10-09", "2", "512.10"),
    // After the rates snapshot ends: a lot with no cost, never a block.
    trade(t212, O, "buy", "2026-10-09", "4", "58.12"),
    // Shares moved out of IBKR, which is not read yet.
    {
      kind: "ignored",
      reason: "securitiesTransfer",
      broker: "ibkr",
      account: ibkr.account,
      source: { fileId: ibkr.fileId, row: 99 },
    },
  ];
  const reach: FileReach[] = [
    { account: ibkr.account, lastDate: "2026-09-30", fileId: ibkr.fileId },
    { account: t212.account, lastDate: "2026-10-09", fileId: t212.fileId },
  ];
  return { ibkr, t212, events, reach };
}

/** Holdings as plain strings, the way the CLI prints them. */
function plain(holdings: Holdings) {
  return {
    accounts: holdings.accounts.map((a) => ({
      account: a.label.key,
      asOf: a.asOf,
      files: a.files.length,
      transferred: a.transferred,
      refusedRows: a.refusedRows,
      positions: a.positions.map(
        (p) =>
          `${p.security.symbol ?? p.isin} ${p.quantity.toPlain(8, "halfUp")}`,
      ),
    })),
    securities: holdings.securities.map((s) => ({
      symbol: s.security.symbol,
      asOf: s.asOf,
      quantity: s.quantity.toPlain(8, "halfUp"),
      costEur: s.costEur?.toFixed(2, "halfUp") ?? null,
      incomplete: s.incomplete,
      lots: s.lots.map((l) => ({
        account: l.account.key,
        bought: l.purchaseDate,
        quantity: l.quantity.toPlain(8, "halfUp"),
        price: `${l.price.amount.toPlain(8, "halfUp")} ${l.price.currency}`,
        rate:
          l.rate === null
            ? `none (${l.missingRate ?? "?"})`
            : `${l.rate.published} ${l.rate.listDate} ${l.rate.source}`,
        unitCostEur: l.unitCostEur?.toFixed(8, "halfUp") ?? null,
        costEur: l.costEur?.toFixed(2, "halfUp") ?? null,
        bucket: l.outlook.bucket,
        next: l.outlook.next,
      })),
    })),
  };
}

function holdingsOf(
  events: readonly LedgerEvent[],
  reach: readonly FileReach[],
  carried: readonly Diagnostic[] = [],
) {
  return buildHoldings({
    ledger: validateLedger(events, carried),
    rates,
    reach,
  });
}

describe("buildHoldings", () => {
  it("gives each account's positions and the open FIFO lots across accounts", () => {
    const { events, reach } = session();
    expect(plain(holdingsOf(events, reach))).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "account": "ibkr-1",
            "asOf": "2026-09-30",
            "files": 1,
            "positions": [
              "AAPL 45",
              "MSFT 5",
            ],
            "refusedRows": false,
            "transferred": true,
          },
          {
            "account": "trading212-1",
            "asOf": "2026-10-09",
            "files": 1,
            "positions": [
              "VWCE 3",
              "AAPL 2",
              "MSFT 2",
              "NVDA -5",
              "O 4",
            ],
            "refusedRows": false,
            "transferred": false,
          },
        ],
        "securities": [
          {
            "asOf": "2026-10-09",
            "costEur": "423.60",
            "incomplete": false,
            "lots": [
              {
                "account": "trading212-1",
                "bought": "2026-06-15",
                "bucket": "25",
                "costEur": "423.60",
                "next": {
                  "bucket": "20",
                  "from": "2031-06-16",
                },
                "price": "141.2 EUR",
                "quantity": "3",
                "rate": "1 2026-06-15 eur",
                "unitCostEur": "141.20000000",
              },
            ],
            "quantity": "3",
            "symbol": "VWCE",
          },
          {
            "asOf": "2026-09-30",
            "costEur": "3632.13",
            "incomplete": false,
            "lots": [
              {
                "account": "ibkr-1",
                "bought": "2019-08-14",
                "bucket": "20",
                "costEur": "1442.40",
                "next": {
                  "bucket": "15",
                  "from": "2029-08-15",
                },
                "price": "50.43 USD",
                "quantity": "32",
                "rate": "1.1188 2019-08-14 bsi-daily",
                "unitCostEur": "45.07508044",
              },
              {
                "account": "trading212-1",
                "bought": "2021-01-04",
                "bucket": "20",
                "costEur": "1052.46",
                "next": {
                  "bucket": "15",
                  "from": "2031-01-05",
                },
                "price": "129.41 USD",
                "quantity": "10",
                "rate": "1.2296 2021-01-04 bsi-daily",
                "unitCostEur": "105.24560833",
              },
              {
                "account": "ibkr-1",
                "bought": "2025-03-03",
                "bucket": "25",
                "costEur": "1137.27",
                "next": {
                  "bucket": "20",
                  "from": "2030-03-04",
                },
                "price": "238.03 USD",
                "quantity": "5",
                "rate": "1.0465 2025-03-03 bsi-daily",
                "unitCostEur": "227.45341615",
              },
            ],
            "quantity": "47",
            "symbol": "AAPL",
          },
          {
            "asOf": "2026-09-30",
            "costEur": "106.47",
            "incomplete": false,
            "lots": [
              {
                "account": "ibkr-1",
                "bought": "2010-03-01",
                "bucket": "0",
                "costEur": "106.47",
                "next": null,
                "price": "28.8 USD",
                "quantity": "5",
                "rate": "1.3525 2010-03-01 bsi-daily",
                "unitCostEur": "21.29390018",
              },
            ],
            "quantity": "5",
            "symbol": "MSFT",
          },
          {
            "asOf": "2026-10-09",
            "costEur": "0.00",
            "incomplete": true,
            "lots": [],
            "quantity": "0",
            "symbol": "NVDA",
          },
          {
            "asOf": "2026-10-09",
            "costEur": null,
            "incomplete": false,
            "lots": [
              {
                "account": "trading212-1",
                "bought": "2026-10-09",
                "bucket": "25",
                "costEur": null,
                "next": {
                  "bucket": "20",
                  "from": "2031-10-10",
                },
                "price": "58.12 USD",
                "quantity": "4",
                "rate": "none (afterSnapshot)",
                "unitCostEur": null,
              },
            ],
            "quantity": "4",
            "symbol": "O",
          },
        ],
      }
    `);
  });

  it("gives the same holdings whatever order the events and files come in", () => {
    const { events, reach } = session();
    expect(holdingsOf([...events].reverse(), [...reach].reverse())).toEqual(
      holdingsOf(events, reach),
    );
  });

  it("flags an account a blocking finding points into", () => {
    const { t212, events, reach } = session();
    const refused = diagnostic(
      "blocking",
      "unsupportedAction",
      { broker: "trading212", action: "Transfer in" },
      { fileId: t212.fileId, row: 7 },
    );
    const accounts = holdingsOf(events, reach, [refused]).accounts;
    expect(accounts.map((a) => [a.label.key, a.refusedRows])).toEqual([
      ["ibkr-1", false],
      ["trading212-1", true],
    ]);
  });

  it("lists an account whose files only moved shares, with its flag", () => {
    const only = file("ibkr", "moved.xml", accountScope("ibkr", "U1111111"));
    const { events, reach } = session();
    const holdings = holdingsOf(
      [
        ...events,
        {
          kind: "ignored",
          reason: "securitiesTransfer",
          broker: "ibkr",
          account: only.account,
          source: { fileId: only.fileId, row: 2 },
        },
      ],
      [
        ...reach,
        { account: only.account, lastDate: "2026-08-31", fileId: only.fileId },
      ],
    );
    expect(
      holdings.accounts.map((a) => [
        a.label.key,
        a.asOf,
        a.transferred,
        a.positions.length,
      ]),
    ).toEqual([
      ["ibkr-1", "2026-09-30", true, 2],
      ["ibkr-2", "2026-08-31", true, 0],
      ["trading212-1", "2026-10-09", false, 5],
    ]);
  });

  it("takes an account's as-of day as far as its own trades reach past the snapshot", () => {
    // A trade dated far ahead is the files' own claim: shown, never clamped
    // to a clock, and the lot has no rate rather than a guessed one.
    const far = file("ibkr", "far.xml", accountScope("ibkr", "U2222222"));
    const holdings = holdingsOf(
      [trade(far, AAPL, "buy", "2099-01-02", "1", "100")],
      [{ account: far.account, lastDate: "2099-01-02", fileId: far.fileId }],
    );
    const [aapl] = holdings.securities;
    expect(holdings.accounts[0]?.asOf).toBe("2099-01-02");
    expect(aapl?.asOf).toBe("2099-01-02");
    expect(aapl?.lots[0]?.missingRate).toBe("afterSnapshot");
    expect(aapl?.costEur).toBeNull();
  });

  it("does not let a cash row past the snapshot age every lot", () => {
    // A deposit dated 2099 is how far the file reaches, not a day its
    // shares were held to: as of 2099, every lot would look exempt.
    const t212 = file("trading212", "t212.csv", accountGroup("trading212", 1));
    const holdings = holdingsOf(
      [
        trade(t212, AAPL, "buy", "2026-01-06", "2", "243.36"),
        {
          kind: "ignored",
          reason: "deposit",
          broker: "trading212",
          account: t212.account,
          source: { fileId: t212.fileId, row: 9 },
        },
      ],
      [{ account: t212.account, lastDate: "2099-01-05", fileId: t212.fileId }],
    );
    expect(holdings.accounts[0]?.asOf).toBe("2026-10-07");
    expect(holdings.securities[0]?.lots[0]?.outlook).toEqual({
      bucket: "25",
      next: { bucket: "20", from: "2031-01-07" },
    });
  });

  it("holds a lot bought in the last years an ISO date can name", () => {
    // Any year to 9999 passes import; a hostile file must not crash a run.
    const t212 = file("trading212", "t212.csv", accountGroup("trading212", 1));
    const holdings = holdingsOf(
      [trade(t212, AAPL, "buy", "9996-01-01", "1", "100")],
      [{ account: t212.account, lastDate: "9996-01-01", fileId: t212.fileId }],
    );
    expect(holdings.securities[0]?.lots[0]?.outlook).toEqual({
      bucket: "25",
      next: null,
    });
  });

  it("names an account known only by a reach by its broker, never by its scope", () => {
    const holdings = holdingsOf(
      [],
      [
        {
          // Every adapter's scope has a broker before a colon; one without
          // must not give any part of itself away as the broker.
          account: "0123456789abcdef" as AccountScope,
          lastDate: "2026-09-30",
          fileId: fileIdOf(new TextEncoder().encode("odd.csv")),
        },
      ],
    );
    expect(holdings.accounts.map((a) => a.label)).toEqual([
      { key: "unknown-1", broker: "unknown", ordinal: 1 },
    ]);
  });

  it("never lets an account's scope out", () => {
    const { ibkr, t212, events, reach } = session();
    const text = JSON.stringify(plain(holdingsOf(events, reach)));
    const raw = JSON.stringify(
      holdingsOf(events, reach),
      (_, value: unknown) =>
        Decimal.isDecimal(value) ? value.toPlain(8, "halfUp") : value,
    );
    for (const scope of [ibkr.account, t212.account]) {
      expect(text).not.toContain(scope);
      expect(raw).not.toContain(scope);
    }
    expect(raw).not.toContain(IBKR_ACCOUNT);
  });
});
