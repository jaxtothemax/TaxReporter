/**
 * The demo's trades and dividends as ledger events, the shape a broker
 * adapter gives the engine (ADR 0011), so that the demo's returns are built
 * the way every return is. They are the events the Doh-KDVP and Doh-Div
 * builders' tests rebuild the demo from (packages/furs/src/build-*.test.ts),
 * so the files the demo downloads are the golden files those tests check
 * against FURS's schemas.
 *
 * Everything is made up, the taxpayer included: a demo file must never carry
 * the user's own tax number, or it could be imported into their real eDavki
 * account. The payers are the companies' public details.
 */
import {
  accountGroup,
  accountScope,
  Decimal,
  fileIdOf,
  keyBuilder,
  type AccountScope,
  type FileId,
  type IsoDate,
  type KeyBuilder,
  type KeyedEvent,
  type LedgerEvent,
  type SecurityRef,
} from "@taxreporter/core";
import type { PayerInfo, Taxpayer } from "@taxreporter/furs";

import { DEMO_IBKR_FILE, DEMO_TRADING212_FILE } from "./demoPreview";

export const DEMO_TAX_YEAR = 2026;

/** Made up: eight digits that are nobody's tax number in the demo. */
export const DEMO_TAXPAYER: Taxpayer = {
  taxNumber: "12345678",
  name: "Janez Novak",
  address: "Slovenska cesta 1",
  city: "Ljubljana",
  postNumber: "1000",
  postName: "Ljubljana",
  email: "janez.novak@example.com",
  phone: "041123456",
};

/**
 * The last day the demo's exports cover: taken at the end of January, they
 * reach past the 30 days after every sale of the year, so the 30-day rule can
 * decide each loss. A user states the same with `--coverage-end`.
 */
export const DEMO_COVERAGE_END: IsoDate = "2027-01-31";

const AAPL: SecurityRef = {
  isin: "US0378331005",
  symbol: "AAPL",
  name: "Apple Inc.",
};
const NVDA: SecurityRef = {
  isin: "US67066G1040",
  symbol: "NVDA",
  name: "NVIDIA Corp.",
};
const VWCE: SecurityRef = {
  isin: "IE00BK5BQT80",
  symbol: "VWCE",
  name: "Vanguard FTSE All-World UCITS ETF (Acc)",
  isFund: true,
};
const ASML: SecurityRef = {
  isin: "NL0010273215",
  symbol: "ASML",
  name: "ASML Holding N.V.",
};
const O: SecurityRef = {
  isin: "US7561091049",
  symbol: "O",
  name: "Realty Income Corp.",
};
const T: SecurityRef = { isin: "US00206R1023", symbol: "T", name: "AT&T Inc." };
const ULVR: SecurityRef = {
  isin: "GB00B10RZP78",
  symbol: "ULVR",
  name: "Unilever PLC",
};
const ALV: SecurityRef = {
  isin: "DE0008404005",
  symbol: "ALV",
  name: "Allianz SE",
};

/**
 * Who pays each security's dividends, by ISIN. No register of payer tax IDs
 * exists yet, so the ISIN stands in, which eDavki accepts
 * (docs/research/02-furs-doh-div-and-others.md §5).
 */
export const DEMO_PAYERS: ReadonlyMap<string, PayerInfo> = new Map([
  [
    AAPL.isin,
    {
      name: "Apple Inc.",
      address: "One Apple Park Way, Cupertino, CA 95014, United States",
      country: "US",
      identificationNumber: AAPL.isin,
    },
  ],
  [
    O.isin,
    {
      name: "Realty Income Corp.",
      address: "11995 El Camino Real, San Diego, CA 92130, United States",
      country: "US",
      identificationNumber: O.isin,
    },
  ],
  [
    T.isin,
    {
      name: "AT&T Inc.",
      address: "208 S. Akard St., Dallas, TX 75202, United States",
      country: "US",
      identificationNumber: T.isin,
    },
  ],
  [
    ULVR.isin,
    {
      name: "Unilever PLC",
      address: "100 Victoria Embankment, London EC4Y 0DY, United Kingdom",
      country: "GB",
      identificationNumber: ULVR.isin,
    },
  ],
  [
    ALV.isin,
    {
      name: "Allianz SE",
      address: "Königinstraße 28, 80802 München, Germany",
      country: "DE",
      identificationNumber: ALV.isin,
    },
  ],
]);

/** One demo export: its file, its account, its keys and its next row. */
interface DemoFile {
  readonly broker: string;
  readonly fileId: FileId;
  readonly account: AccountScope;
  readonly keys: KeyBuilder;
  row: number;
}

function demoFile(broker: string, name: string, account: AccountScope) {
  const file: DemoFile = {
    broker,
    fileId: fileIdOf(new TextEncoder().encode(name)),
    account,
    keys: keyBuilder(),
    row: 1,
  };
  return file;
}

/** The common fields of the next event read from `file`, dated `date`. */
function next(
  file: DemoFile,
  kind: KeyedEvent["kind"],
  parts: readonly string[],
  date: IsoDate,
) {
  file.row += 1;
  return {
    key: file.keys.key(kind, [...parts, date]),
    broker: file.broker,
    account: file.account,
    source: { fileId: file.fileId, row: file.row },
    // Both demo brokers state a date and no time of day.
    at: { instant: null, brokerDate: date },
    date,
  };
}

/** The demo's events, in a fresh array of fresh objects on every call. */
export function demoLedgerEvents(): LedgerEvent[] {
  const t212 = demoFile(
    "trading212",
    DEMO_TRADING212_FILE,
    accountGroup("trading212", 1),
  );
  const ibkr = demoFile(
    "ibkr",
    DEMO_IBKR_FILE,
    accountScope("ibkr", "demo account"),
  );

  const trade = (
    file: DemoFile,
    security: SecurityRef,
    side: "buy" | "sell",
    date: IsoDate,
    quantity: string,
    price: string,
    currency: string,
  ): LedgerEvent => ({
    kind: "trade",
    ...next(file, "trade", [side, security.isin, quantity, price], date),
    side,
    security,
    quantity: Decimal.parse(quantity),
    price: { amount: Decimal.parse(price), currency },
  });

  const split = (
    file: DemoFile,
    security: SecurityRef,
    date: IsoDate,
    from: string,
    to: string,
  ): LedgerEvent => ({
    kind: "split",
    ...next(file, "split", [security.isin, from, to], date),
    isin: security.isin,
    from: Decimal.parse(from),
    to: Decimal.parse(to),
  });

  /** A dividend and, where any was withheld, the tax on it, on one row. */
  const paid = (
    file: DemoFile,
    security: SecurityRef,
    date: IsoDate,
    gross: string,
    tax: string | null,
    currency: string,
  ): LedgerEvent[] => {
    const dividend = {
      kind: "dividend" as const,
      ...next(file, "dividend", [security.isin, gross], date),
      security,
      gross: { amount: Decimal.parse(gross), currency },
    };
    if (tax === null) return [dividend];
    return [
      dividend,
      {
        kind: "withholding",
        ...next(file, "withholding", [security.isin, tax], date),
        isin: security.isin,
        dividendKey: dividend.key,
        amount: { amount: Decimal.parse(tax), currency },
      },
    ];
  };

  const vwceBuys = [
    ["2024-01-15", "1.3871", "108.14"],
    ["2024-04-15", "1.3304", "112.75"],
    ["2024-07-15", "1.2551", "119.51"],
    ["2024-10-15", "1.2287", "122.08"],
    ["2025-01-15", "1.1102", "135.11"],
    ["2025-04-15", "1.2468", "120.31"],
    ["2025-07-15", "1.1310", "132.63"],
    ["2025-10-15", "1.0745", "139.60"],
  ] as const;

  return [
    trade(ibkr, AAPL, "buy", "2019-08-14", "10", "201.72", "USD"),
    split(ibkr, AAPL, "2020-08-31", "1", "4"),
    trade(ibkr, AAPL, "buy", "2022-03-03", "15", "166.23", "USD"),
    trade(ibkr, AAPL, "sell", "2026-03-12", "45", "214.87", "USD"),
    trade(t212, NVDA, "buy", "2023-05-02", "2", "287.10", "USD"),
    split(ibkr, NVDA, "2024-06-10", "1", "10"),
    trade(ibkr, NVDA, "buy", "2024-08-05", "15", "98.91", "USD"),
    trade(ibkr, NVDA, "sell", "2026-02-11", "25", "178.40", "USD"),
    ...vwceBuys.map(([date, quantity, price]) =>
      trade(t212, VWCE, "buy", date, quantity, price, "EUR"),
    ),
    trade(t212, VWCE, "sell", "2026-06-18", "5.2", "141.92", "EUR"),
    trade(ibkr, ASML, "buy", "2025-07-21", "6", "712.40", "EUR"),
    trade(ibkr, ASML, "sell", "2026-08-04", "6", "641.15", "EUR"),
    ...paid(t212, O, "2026-01-15", "3.23", "0.48", "USD"),
    ...paid(ibkr, AAPL, "2026-02-12", "14.30", "2.14", "USD"),
    ...paid(t212, O, "2026-02-13", "3.23", "0.48", "USD"),
    ...paid(t212, O, "2026-03-13", "3.23", "0.48", "USD"),
    // Nothing withheld: no withholding event at all.
    ...paid(t212, ULVR, "2026-03-20", "17.43", null, "GBP"),
    // 1 May is a TARGET holiday: the 30 April list applies.
    ...paid(ibkr, T, "2026-05-01", "16.65", "2.49", "USD"),
    ...paid(ibkr, ALV, "2026-05-08", "123.20", "32.49", "EUR"),
    ...paid(ibkr, AAPL, "2026-05-14", "2.70", "0.40", "USD"),
    ...paid(ibkr, AAPL, "2026-08-13", "2.70", "0.40", "USD"),
  ];
}
