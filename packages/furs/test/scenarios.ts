/**
 * Form models for the golden files. Every taxpayer detail is a placeholder,
 * the trades are made up, and the exchange rates are real Banka Slovenije
 * values for the dates shown (dtecbs-l.xml; BSI, CC BY 4.0). Per-unit and
 * amount values are computed here exactly as the pipeline will: the foreign
 * amount divided by the BSI rate, left unrounded for the writer to round at
 * the field.
 */
import { Decimal } from "@taxreporter/core";

import type {
  DividendPayer,
  DividendRecord,
  DohDiv,
  DohKdvp,
  KdvpRow,
  Taxpayer,
} from "../src/index.js";

const d = (value: string) => Decimal.parse(value);

/** EUR for a foreign amount at a BSI rate (units of currency per 1 EUR). */
export function eur(amount: string, rate?: string): Decimal {
  return rate === undefined ? d(amount) : d(amount).dividedBy(d(rate));
}

export const TAXPAYER: Taxpayer = {
  taxNumber: "12345678",
  name: "Janez Novak",
  address: "Slovenska cesta 1",
  city: "Ljubljana",
  postNumber: "1000",
  postName: "Ljubljana",
  email: "janez.novak@example.com",
  phone: "041123456",
};

const buy = (
  date: string,
  quantity: string,
  price: string,
  rate?: string,
): KdvpRow => ({
  kind: "purchase",
  date,
  method: "B",
  quantity: d(quantity),
  unitCostEur: eur(price, rate),
});

const sell = (
  date: string,
  quantity: string,
  price: string,
  rate?: string,
  lossReducesBase?: boolean,
): KdvpRow => ({
  kind: "sale",
  date,
  quantity: d(quantity),
  unitValueEur: eur(price, rate),
  ...(lossReducesBase === undefined ? {} : { lossReducesBase }),
});

/**
 * The worked example of docs/research/01-furs-doh-kdvp.md §10, which the
 * researcher validated with xmllint against the live schema: two lots bought
 * in 2024, 12 of 15 shares sold in 2026, listing only the lots the sale
 * consumes (10 of the first, 2 of the second), so F8 ends at 0.
 */
export const kdvpMatchedLots: DohKdvp = {
  taxYear: 2026,
  taxpayer: TAXPAYER,
  lists: [
    {
      isin: "US0378331005",
      ticker: "AAPL",
      name: "Apple Inc.",
      isFund: false,
      rows: [
        buy("2024-03-15", "10", "172.62", "1.0892"),
        buy("2024-08-05", "2", "209.27", "1.0966"),
        sell("2026-05-20", "12", "250.00", "1.16", true),
      ],
    },
  ],
};

/** One lot bought and sold whole at a loss, in EUR, with F10 determined. */
export const kdvpSingleLot: DohKdvp = {
  taxYear: 2026,
  taxpayer: { taxNumber: "12345678" },
  lists: [
    {
      isin: "NL0010273215",
      ticker: "ASML",
      name: "ASML Holding N.V.",
      isFund: false,
      rows: [
        buy("2025-07-21", "6", "712.40"),
        sell("2026-08-04", "6", "641.15", undefined, true),
      ],
    },
  ],
};

/**
 * A position sold over several years: 20 bought in 2021 and 10 in 2022, 15
 * sold in 2024, and the rest of the 2021 lot plus 5 of the 2022 lot sold in
 * 2026. The 2024 sale belongs to that year's return, so this year's list
 * carries only what FIFO leaves for 2026: 5 from 2021 and 5 from 2022
 * (research 01 §8).
 */
export const kdvpPartlySoldAcrossYears: DohKdvp = {
  taxYear: 2026,
  taxpayer: { taxNumber: "12345678" },
  lists: [
    {
      isin: "DE0008404005",
      ticker: "ALV",
      name: "Allianz SE",
      isFund: false,
      rows: [
        buy("2021-03-10", "5", "205.40"),
        buy("2022-06-14", "5", "180.10"),
        sell("2026-09-22", "10", "290.00", undefined, true),
      ],
    },
  ],
};

/**
 * The web app's demo return: Apple across a 4:1 split (pre-split rows
 * restated, dates kept), NVIDIA bought at Trading 212 and Interactive Brokers
 * across a 10:1 split, a fund bought monthly in fractions, and a loss. Whole
 * lots are listed, so F8 ends above zero where lots remain.
 */
export const kdvpDemo2026: DohKdvp = {
  taxYear: 2026,
  taxpayer: TAXPAYER,
  lists: [
    {
      isin: "US0378331005",
      ticker: "AAPL",
      name: "Apple Inc.",
      isFund: false,
      rows: [
        buy("2019-08-14", "40", "50.43", "1.1188"),
        buy("2022-03-03", "15", "166.23", "1.1076"),
        sell("2026-03-12", "45", "214.87", "1.1547"),
      ],
    },
    {
      isin: "US67066G1040",
      ticker: "NVDA",
      name: "NVIDIA Corp.",
      isFund: false,
      rows: [
        buy("2023-05-02", "20", "28.71", "1.0965"),
        buy("2024-08-05", "15", "98.91", "1.0966"),
        sell("2026-02-11", "25", "178.40", "1.1900"),
      ],
    },
    {
      isin: "IE00BK5BQT80",
      ticker: "VWCE",
      name: "Vanguard FTSE All-World UCITS ETF (Acc)",
      isFund: true,
      rows: [
        buy("2024-01-15", "1.3871", "108.14"),
        buy("2024-04-15", "1.3304", "112.75"),
        buy("2024-07-15", "1.2551", "119.51"),
        buy("2024-10-15", "1.2287", "122.08"),
        buy("2025-01-15", "1.1102", "135.11"),
        buy("2025-04-15", "1.2468", "120.31"),
        buy("2025-07-15", "1.1310", "132.63"),
        buy("2025-10-15", "1.0745", "139.60"),
        sell("2026-06-18", "5.2", "141.92"),
      ],
    },
    {
      isin: "NL0010273215",
      ticker: "ASML",
      name: "ASML Holding N.V.",
      isFund: false,
      rows: [
        buy("2025-07-21", "6", "712.40"),
        sell("2026-08-04", "6", "641.15", undefined, true),
      ],
    },
  ],
};

/**
 * The example of docs/research/02-furs-doh-div-and-others.md §8, validated
 * there with xmllint: a US dividend with 15% withheld and the community-style
 * relief statement, and an Irish ETF distribution with nothing withheld.
 */
export const divResearchExample: DohDiv = {
  taxYear: 2026,
  taxpayer: TAXPAYER,
  dividends: [
    {
      date: "2026-05-14",
      payer: {
        name: "Apple Inc.",
        address: "One Apple Park Way, Cupertino, CA 95014, United States",
        country: "US",
        identificationNumber: "94-2404110",
      },
      type: "1",
      grossEur: eur("26.00", "1.1702"),
      foreignTaxEur: eur("3.90", "1.1702"),
      sourceCountry: "US",
      reliefStatement: "10/01, 2b odstavek 10. člena",
    },
    {
      date: "2026-06-24",
      payer: {
        name: "Vanguard Funds plc (Vanguard FTSE All-World UCITS ETF Dist)",
        address: "70 Sir John Rogerson's Quay, Dublin 2, Ireland",
        country: "IE",
        identificationNumber: "499158",
      },
      type: "4",
      grossEur: eur("15.00", "1.1340"),
      foreignTaxEur: eur("0", "1.1340"),
      sourceCountry: "IE",
    },
  ],
};

const REALTY_INCOME: DividendPayer = {
  name: "Realty Income Corp.",
  address: "11995 El Camino Real, San Diego, CA 92130, United States",
  country: "US",
  // No register of payer tax IDs exists yet; the ISIN stands in, which
  // eDavki accepts (research 02 §5).
  identificationNumber: "US7561091049",
};

const APPLE: DividendPayer = {
  name: "Apple Inc.",
  address: "One Apple Park Way, Cupertino, CA 95014, United States",
  country: "US",
  identificationNumber: "US0378331005",
};

const ATT: DividendPayer = {
  name: "AT&T Inc.",
  address: "208 S. Akard St., Dallas, TX 75202, United States",
  country: "US",
  identificationNumber: "US00206R1023",
};

const UNILEVER: DividendPayer = {
  name: "Unilever PLC",
  address: "100 Victoria Embankment, London EC4Y 0DY, United Kingdom",
  country: "GB",
  identificationNumber: "GB00B10RZP78",
};

const ALLIANZ: DividendPayer = {
  name: "Allianz SE",
  address: "Königinstraße 28, 80802 München, Germany",
  country: "DE",
  identificationNumber: "DE0008404005",
};

/** An ordinary dividend (type 1) taxed where its payer is resident. */
const payment = (
  date: string,
  payer: DividendPayer,
  gross: string,
  tax: string,
  rate?: string,
): DividendRecord => ({
  date,
  payer,
  type: "1",
  grossEur: eur(gross, rate),
  foreignTaxEur: eur(tax, rate),
  sourceCountry: payer.country,
});

/** The web app's demo dividends, one record per payment, in payment order. */
export const divDemo2026: DohDiv = {
  taxYear: 2026,
  taxpayer: TAXPAYER,
  dividends: [
    payment("2026-01-15", REALTY_INCOME, "3.23", "0.48", "1.1624"),
    payment("2026-02-12", APPLE, "14.30", "2.14", "1.1874"),
    payment("2026-02-13", REALTY_INCOME, "3.23", "0.48", "1.1862"),
    payment("2026-03-13", REALTY_INCOME, "3.23", "0.48", "1.1476"),
    payment("2026-03-20", UNILEVER, "17.43", "0", "0.86438"),
    // 1 May is a TARGET holiday: the 30 April list's rate applies.
    payment("2026-05-01", ATT, "16.65", "2.49", "1.1702"),
    payment("2026-05-08", ALLIANZ, "123.20", "32.49"),
    payment("2026-05-14", APPLE, "2.70", "0.40", "1.1702"),
    payment("2026-08-13", APPLE, "2.70", "0.40", "1.1534"),
  ],
};

/** Every golden file and the form it is written from. */
export const GOLDEN = {
  "doh-kdvp-matched-lots.xml": { form: "kdvp", model: kdvpMatchedLots },
  "doh-kdvp-single-lot.xml": { form: "kdvp", model: kdvpSingleLot },
  "doh-kdvp-partly-sold-across-years.xml": {
    form: "kdvp",
    model: kdvpPartlySoldAcrossYears,
  },
  "doh-kdvp-demo-2026.xml": { form: "kdvp", model: kdvpDemo2026 },
  "doh-div-research-example.xml": { form: "div", model: divResearchExample },
  "doh-div-demo-2026.xml": { form: "div", model: divDemo2026 },
} as const;
