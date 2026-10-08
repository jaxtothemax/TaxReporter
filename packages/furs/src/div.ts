/**
 * Doh-Div: the return for dividends from payers that do not withhold
 * Slovenian tax, as eDavki imports it (Doh_Div_3.xsd). One `Dividend` record
 * per payment, with the gross amount and the foreign tax in EUR.
 *
 * The Doh-Div schema is permissive (a negative amount, Type 99 or country
 * "IRL" all validate), so this module enforces FURS's business rules before
 * writing (docs/research/02-furs-doh-div-and-others.md §3, §9).
 */
import { Decimal } from "@taxreporter/core";

import {
  checkTaxpayer,
  checkText,
  EDP_NAMESPACE,
  given,
  header,
  isIsoDate,
  isTaxNumber,
  isTaxYear,
  type IsoDate,
  type Taxpayer,
} from "./common.js";
import { isFursCountry, type FursCountry } from "./countries.js";
import { FormValidationError, type FormIssue } from "./issues.js";
import { element, optional, serialize, text, type XmlElement } from "./xml.js";

export const DIV_NAMESPACE =
  "http://edavki.durs.si/Documents/Schemas/Doh_Div_3.xsd";

/**
 * Šifra vrste dividend (research 02 §4.1): 1 a distribution of company profit
 * (ordinary dividends), 2 hidden profit distribution, 3 profit on
 * profit-participating debt securities, 4 investment-fund distributions
 * (ETFs and UCITS), 5 returned subsequent contributions, 6 earn-out payments
 * on the disposal of a share, 7 own-share acquisitions.
 */
export const DIVIDEND_TYPES = Object.freeze([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
] as const);
export type DividendType = (typeof DIVIDEND_TYPES)[number];

export interface DividendPayer {
  readonly name: string;
  readonly address: string;
  readonly country: FursCountry;
  /**
   * The payer's ID in its own state (a US EIN, an EU tax ID, a registration
   * number). Required for foreign payers; FURS rejects two records with the
   * same ID on the same day (research 02 §5).
   */
  readonly identificationNumber?: string;
  /** Slovenian payers only: their eight-digit tax number. */
  readonly taxNumber?: string;
}

export interface DividendRecord {
  /** The day the dividend was paid. */
  readonly date: IsoDate;
  readonly payer: DividendPayer;
  readonly type: DividendType;
  /** Gross amount in EUR at the BSI rate of `date`; rounded half up to cents. */
  readonly grossEur: Decimal;
  /**
   * Foreign tax actually withheld, in EUR at the same rate: zero when none
   * was withheld, absent for a Slovenian payer (which must not have it).
   */
  readonly foreignTaxEur?: Decimal;
  /** The country the income comes from, which may differ from the payer's. */
  readonly sourceCountry: FursCountry;
  /**
   * A claim for exemption under a tax treaty. FURS frames this field as an
   * exemption claim, while residents with US dividends get a credit, so it
   * is filled only on the user's explicit choice (research 02 §6).
   */
  readonly reliefStatement?: string;
}

export interface DohDiv {
  readonly taxYear: number;
  readonly taxpayer: Taxpayer;
  readonly dividends: readonly DividendRecord[];
}

/** Doh-Div amounts are `xs:decimal` with two fraction digits (Amount_Type). */
const AMOUNT_SCALE = 2;
const amount = (value: Decimal) => value.toFixed(AMOUNT_SCALE, "halfUp");

/**
 * Amount_Type sets no limit, so this is a bound like Doh-KDVP's 14 integer
 * digits for per-unit values: far above any real dividend.
 */
const MAX_AMOUNT = Decimal.parse("99999999999999.99");

function checkDividend(
  dividend: DividendRecord,
  path: string,
  taxYear: number,
  issues: FormIssue[],
): void {
  if (!isIsoDate(dividend.date)) {
    issues.push({ code: "invalidDate", path: `${path}.date` });
  } else if (!dividend.date.startsWith(`${String(taxYear)}-`)) {
    issues.push({ code: "dividendOutsideTaxYear", path: `${path}.date` });
  }

  const payer = dividend.payer;
  const slovenian = payer.country === "SI";
  checkText(payer.name, `${path}.payer.name`, issues, { required: true });
  checkText(payer.address, `${path}.payer.address`, issues, {
    required: true,
  });
  if (!isFursCountry(payer.country)) {
    issues.push({ code: "country", path: `${path}.payer.country` });
  }
  if (!isFursCountry(dividend.sourceCountry)) {
    issues.push({ code: "country", path: `${path}.sourceCountry` });
  }
  if (slovenian) {
    if (!isTaxNumber(payer.taxNumber)) {
      issues.push({ code: "payerTaxNumber", path: `${path}.payer.taxNumber` });
    }
  } else {
    if (given(payer.taxNumber)) {
      issues.push({
        code: "payerTaxNumberForForeignPayer",
        path: `${path}.payer.taxNumber`,
      });
    }
    // The 2026 XML guide makes the ID mandatory for foreign payers; other
    // FURS documents call it optional, so the stricter reading is used.
    if (!given(payer.identificationNumber)) {
      issues.push({
        code: "payerIdMissing",
        path: `${path}.payer.identificationNumber`,
      });
    }
  }
  checkText(
    payer.identificationNumber,
    `${path}.payer.identificationNumber`,
    issues,
  );

  if (!(DIVIDEND_TYPES as readonly string[]).includes(dividend.type)) {
    issues.push({ code: "dividendType", path: `${path}.type` });
  }

  // Compared at the scale they are written at: the rounded values are the
  // ones eDavki sees.
  const gross = dividend.grossEur.round(AMOUNT_SCALE, "halfUp");
  if (!gross.isPositive()) {
    issues.push({ code: "valueNotPositive", path: `${path}.grossEur` });
  } else if (gross.greaterThan(MAX_AMOUNT)) {
    issues.push({ code: "valueTooLarge", path: `${path}.grossEur` });
  }
  const foreignTax = given(dividend.foreignTaxEur)
    ? dividend.foreignTaxEur
    : undefined;
  const tax = foreignTax?.round(AMOUNT_SCALE, "halfUp");
  if (slovenian && tax !== undefined) {
    issues.push({
      code: "foreignTaxForSlovenianPayer",
      path: `${path}.foreignTaxEur`,
    });
  } else if (!slovenian && tax === undefined) {
    issues.push({ code: "foreignTaxMissing", path: `${path}.foreignTaxEur` });
  } else if (foreignTax?.isNegative() === true) {
    // Before rounding: -0.004 would otherwise pass as 0.00.
    issues.push({ code: "valueNegative", path: `${path}.foreignTaxEur` });
  } else if (tax !== undefined && tax.greaterThan(gross)) {
    issues.push({
      code: "foreignTaxAboveValue",
      path: `${path}.foreignTaxEur`,
    });
  }

  // The eDavki form and the CSV guide limit the statement to 100 characters.
  checkText(dividend.reliefStatement, `${path}.reliefStatement`, issues, {
    maxLength: 100,
  });
}

/** Every rule the schema does not enforce, in model order. Empty means writable. */
export function validateDohDiv(form: DohDiv): FormIssue[] {
  const issues: FormIssue[] = [];
  if (!isTaxYear(form.taxYear))
    issues.push({ code: "taxYear", path: "taxYear" });
  checkTaxpayer(form.taxpayer, issues);
  if (form.dividends.length === 0) {
    issues.push({ code: "noDividends", path: "dividends" });
  }
  // Two records with the same payer ID on the same day are a critical error
  // in eDavki (research 02 §5); the code that builds the records must give
  // same-day payments from one payer distinct IDs. IDs are compared without
  // case or spaces, so "us 94-2404110" and "US94-2404110" are one payer.
  const seen = new Set<string>();
  // An index loop, not forEach, so the holes of a sparse array are caught.
  for (let i = 0; i < form.dividends.length; i += 1) {
    const path = `dividends[${String(i)}]`;
    const dividend = form.dividends[i];
    if (!given(dividend)) {
      issues.push({ code: "entryMissing", path });
      continue;
    }
    checkDividend(dividend, path, form.taxYear, issues);
    const id: unknown = dividend.payer.identificationNumber;
    if (typeof id === "string") {
      const key = `${dividend.date} ${id.replace(/\s+/g, "").toUpperCase()}`;
      if (seen.has(key)) {
        issues.push({
          code: "duplicatePayerId",
          path: `${path}.payer.identificationNumber`,
        });
      }
      seen.add(key);
    }
  }
  return issues;
}

function dividendElement(dividend: DividendRecord): XmlElement {
  const payer = dividend.payer;
  return element("Dividend", [
    text("Date", dividend.date),
    optional("PayerTaxNumber", payer.taxNumber),
    optional("PayerIdentificationNumber", payer.identificationNumber),
    text("PayerName", payer.name),
    text("PayerAddress", payer.address),
    text("PayerCountry", payer.country),
    text("Type", dividend.type),
    text("Value", amount(dividend.grossEur)),
    optional(
      "ForeignTax",
      given(dividend.foreignTaxEur)
        ? amount(dividend.foreignTaxEur)
        : undefined,
    ),
    text("SourceCountry", dividend.sourceCountry),
    optional("ReliefStatement", dividend.reliefStatement),
  ]);
}

/**
 * The return as eDavki XML. Refuses a form with any issue: the caller shows
 * `validateDohDiv`'s issues to the user first, and this is the safety net.
 */
export function writeDohDiv(form: DohDiv): string {
  const issues = validateDohDiv(form);
  if (issues.length > 0) throw new FormValidationError("Doh-Div", issues);
  return serialize(
    element(
      "Envelope",
      [
        // FURS's own Doh-Div template writes edp:domain; its KDVP examples do not.
        header(form.taxpayer, { domain: "edavki.durs.si" }),
        element("edp:AttachmentList"),
        element("edp:Signatures"),
        // Unlike Doh-KDVP, the Doh-Div body has no edp:bodyContent, and the
        // Dividend records are siblings of Doh_Div, not its children.
        element("body", [
          element("Doh_Div", [
            text("Period", String(form.taxYear)),
            optional("EmailAddress", form.taxpayer.email),
            optional("PhoneNumber", form.taxpayer.phone),
            text("ResidentCountry", "SI"),
            text("IsResident", "true"),
            text("SelfReport", "false"),
            text("WfTypeU", "false"),
          ]),
          ...form.dividends.map(dividendElement),
        ]),
      ],
      [
        ["xmlns", DIV_NAMESPACE],
        ["xmlns:edp", EDP_NAMESPACE],
      ],
    ),
  );
}
