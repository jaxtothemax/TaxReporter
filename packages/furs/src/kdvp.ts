/**
 * Doh-KDVP: the return for gains on securities, as eDavki imports it
 * (Doh_KDVP_9.xsd). One inventory list ("popisni list") per security, each a
 * PLVP list of purchase and sale rows in EUR per unit.
 *
 * This module takes a finished list model; it does not decide which lots a
 * sale consumes or convert currencies. It checks the rules the schema leaves
 * out, then writes the XML in schema order. Field mapping, element order and
 * limits: docs/research/01-furs-doh-kdvp.md §3–§7.
 */
import { Decimal } from "@taxreporter/core";

import {
  checkTaxpayer,
  checkText,
  EDP_NAMESPACE,
  header,
  isIsoDate,
  isTaxYear,
  type IsoDate,
  type Taxpayer,
} from "./common.js";
import { FormValidationError, type FormIssue } from "./issues.js";
import { element, optional, serialize, text, type XmlElement } from "./xml.js";

export const KDVP_NAMESPACE =
  "http://edavki.durs.si/Documents/Schemas/Doh_KDVP_9.xsd";

/**
 * F2 on a long (PLVP) list, limited to what data from a foreign broker can
 * need: B purchase, D bonus issue from company funds, E exchange on a merger
 * or division, F inheritance, G gift, H other. A and C do not arise from a
 * broker export, and I, J and K mean different things on different list
 * types and in different FURS sources, so they are left to manual entry
 * (research 01 §6).
 */
export const ACQUISITION_METHODS = ["B", "D", "E", "F", "G", "H"] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number];

export interface KdvpPurchase {
  readonly kind: "purchase";
  /** F1: the trade (contract) date, never the settlement date. */
  readonly date: IsoDate;
  /** F2. */
  readonly method: AcquisitionMethod;
  /** F3: must fit 8 decimals exactly; quantities are never rounded here. */
  readonly quantity: Decimal;
  /** F4: acquisition value per unit in EUR, at the BSI rate of `date`. */
  readonly unitCostEur: Decimal;
  /** F5: inheritance or gift tax paid on this acquisition, EUR. */
  readonly inheritanceOrGiftTaxEur?: Decimal;
}

export interface KdvpSale {
  readonly kind: "sale";
  /** F6: the trade date. */
  readonly date: IsoDate;
  /** F7: must fit 8 decimals exactly. */
  readonly quantity: Decimal;
  /** F9: value at disposal per unit in EUR, at the BSI rate of `date`. */
  readonly unitValueEur: Decimal;
  /**
   * F10, column 10: true ("DA") when the condition for the loss to reduce
   * the positive tax base is met, i.e. no same-kind capital was acquired in
   * the 30 days before or after the sale (Art. 97(2) and (5) ZDoh-2).
   * Written only once it has been determined; eDavki's display shows an
   * absent F10 as "Ne" (research 01 §5.2).
   */
  readonly lossReducesBase?: boolean;
}

export type KdvpRow = KdvpPurchase | KdvpSale;

/** One PLVP inventory list: a security or fund unit held long. */
export interface KdvpList {
  readonly isin: string;
  /** `Code`, the ticker: at most 10 characters. */
  readonly ticker?: string;
  /** The security's name, also the list's title: at most 100 characters. */
  readonly name: string;
  /** `IsFond`: a fund unit (investicijski kupon) rather than a security. */
  readonly isFund: boolean;
  /** In chronological order; F8 is computed from them. */
  readonly rows: readonly KdvpRow[];
}

export interface DohKdvp {
  readonly taxYear: number;
  readonly taxpayer: Taxpayer;
  readonly lists: readonly KdvpList[];
}

/**
 * Field scales (ADR 0006). Quantities are written exactly or not at all:
 * rounding one would break the running balance, so the code that builds the
 * rows reconciles any residual in the open. Per-unit values are rounded half
 * up to 8 decimals, which FURS does not prescribe but every working tool and
 * the research use (research 01 §7); F5 allows only 4.
 */
const QUANTITY_SCALE = 8;
const UNIT_VALUE_SCALE = 8;
const TAX_SCALE = 4;

const MAX_QUANTITY = Decimal.parse("999999999999.99999999"); // 12 + 8 digits
const MAX_UNIT_VALUE = Decimal.parse("99999999999999.99999999"); // 14 + 8
const MAX_TAX = Decimal.parse("9999999999.9999"); // 10 + 4

/** ISO 6166: two letters, nine alphanumerics, a Luhn check digit. */
export function isIsin(value: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value)) return false;
  // Letters count as two digits (A = 10 ... Z = 35); the pattern above has
  // already made the string ASCII.
  let digits = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    digits += code >= 65 ? String(code - 55) : value.charAt(i);
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function checkQuantity(
  quantity: Decimal,
  path: string,
  issues: FormIssue[],
): void {
  if (!quantity.isPositive()) {
    issues.push({ code: "quantityNotPositive", path });
  } else if (!quantity.isExactAt(QUANTITY_SCALE)) {
    issues.push({ code: "quantityPrecision", path });
  } else if (quantity.greaterThan(MAX_QUANTITY)) {
    issues.push({ code: "quantityTooLarge", path });
  }
}

function checkValue(
  value: Decimal,
  max: Decimal,
  scale: number,
  path: string,
  issues: FormIssue[],
): void {
  if (value.isNegative()) {
    issues.push({ code: "valueNegative", path });
  } else if (value.round(scale, "halfUp").greaterThan(max)) {
    issues.push({ code: "valueTooLarge", path });
  }
}

function checkRows(
  list: KdvpList,
  path: string,
  taxYear: number,
  issues: FormIssue[],
): void {
  const yearStart = `${String(taxYear)}-01-01`;
  const yearEnd = `${String(taxYear)}-12-31`;
  let balance = Decimal.ZERO;
  let previousDate: string | null = null;
  list.rows.forEach((row, i) => {
    const at = `${path}.rows[${String(i)}]`;
    if (!isIsoDate(row.date)) {
      issues.push({ code: "invalidDate", path: `${at}.date` });
    } else {
      // The instructions list rows "po kronološkem zaporedju" (column 1).
      if (previousDate !== null && row.date < previousDate) {
        issues.push({ code: "rowsNotChronological", path: `${at}.date` });
      }
      previousDate = row.date;
      if (row.kind === "purchase" && row.date > yearEnd) {
        issues.push({ code: "purchaseAfterTaxYear", path: `${at}.date` });
      }
      if (row.kind === "sale" && (row.date < yearStart || row.date > yearEnd)) {
        issues.push({ code: "saleOutsideTaxYear", path: `${at}.date` });
      }
    }
    checkQuantity(row.quantity, `${at}.quantity`, issues);
    if (row.kind === "purchase") {
      checkValue(
        row.unitCostEur,
        MAX_UNIT_VALUE,
        UNIT_VALUE_SCALE,
        `${at}.unitCostEur`,
        issues,
      );
      if (row.inheritanceOrGiftTaxEur !== undefined) {
        checkValue(
          row.inheritanceOrGiftTaxEur,
          MAX_TAX,
          TAX_SCALE,
          `${at}.inheritanceOrGiftTaxEur`,
          issues,
        );
      }
      balance = balance.plus(row.quantity);
    } else {
      checkValue(
        row.unitValueEur,
        MAX_UNIT_VALUE,
        UNIT_VALUE_SCALE,
        `${at}.unitValueEur`,
        issues,
      );
      balance = balance.minus(row.quantity);
    }
    // A long list never goes short: eDavki reportedly rejects a negative
    // running stock there (research 01 §8, unverified), and a negative
    // balance always means a purchase is missing.
    if (balance.isNegative()) {
      issues.push({ code: "negativeBalance", path: at });
    } else if (balance.greaterThan(MAX_QUANTITY)) {
      issues.push({ code: "balanceTooLarge", path: at });
    }
  });
}

/** Every rule the schema does not enforce, in model order. Empty means writable. */
export function validateDohKdvp(form: DohKdvp): FormIssue[] {
  const issues: FormIssue[] = [];
  if (!isTaxYear(form.taxYear))
    issues.push({ code: "taxYear", path: "taxYear" });
  checkTaxpayer(form.taxpayer, issues);
  if (form.lists.length === 0) issues.push({ code: "noLists", path: "lists" });
  const seen = new Set<string>();
  form.lists.forEach((list, i) => {
    const path = `lists[${String(i)}]`;
    if (!isIsin(list.isin)) issues.push({ code: "isin", path: `${path}.isin` });
    // One list per security, merged across brokers: FIFO runs per ISIN over
    // all of the taxpayer's holdings (research 01 §8).
    if (seen.has(list.isin)) {
      issues.push({ code: "duplicateList", path: `${path}.isin` });
    }
    seen.add(list.isin);
    checkText(list.ticker, `${path}.ticker`, issues, { maxLength: 10 });
    checkText(list.name, `${path}.name`, issues, {
      required: true,
      maxLength: 100,
    });
    // eDavki counts a list as correctly entered only with at least one
    // acquisition and one disposal (research 01 §8).
    if (!list.rows.some((row) => row.kind === "purchase")) {
      issues.push({ code: "listWithoutPurchase", path });
    }
    if (!list.rows.some((row) => row.kind === "sale")) {
      issues.push({ code: "listWithoutSale", path });
    }
    checkRows(list, path, form.taxYear, issues);
  });
  return issues;
}

const quantity = (value: Decimal) => value.toPlain(QUANTITY_SCALE, "down");
const unitValue = (value: Decimal) => value.toPlain(UNIT_VALUE_SCALE, "halfUp");
const bool = (value: boolean) => (value ? "true" : "false");

function rowElements(rows: readonly KdvpRow[]): XmlElement[] {
  let balance = Decimal.ZERO;
  return rows.map((row, id) => {
    let body: XmlElement;
    if (row.kind === "purchase") {
      balance = balance.plus(row.quantity);
      body = element("Purchase", [
        text("F1", row.date),
        text("F2", row.method),
        text("F3", quantity(row.quantity)),
        text("F4", unitValue(row.unitCostEur)),
        optional(
          "F5",
          row.inheritanceOrGiftTaxEur?.toPlain(TAX_SCALE, "halfUp"),
        ),
      ]);
    } else {
      balance = balance.minus(row.quantity);
      body = element("Sale", [
        text("F6", row.date),
        text("F7", quantity(row.quantity)),
        text("F9", unitValue(row.unitValueEur)),
        optional(
          "F10",
          row.lossReducesBase === undefined
            ? undefined
            : bool(row.lossReducesBase),
        ),
      ]);
    }
    // IDs run from 0 in row order, as eDavki numbers them by position anyway.
    return element("Row", [
      text("ID", String(id)),
      body,
      text("F8", quantity(balance)),
    ]);
  });
}

function listElement(list: KdvpList): XmlElement {
  return element("KDVPItem", [
    text("InventoryListType", "PLVP"),
    text("Name", list.name),
    text("HasForeignTax", "false"),
    text("HasLossTransfer", "false"),
    text("ForeignTransfer", "false"),
    text("TaxDecreaseConformance", "false"),
    element("Securities", [
      text("ISIN", list.isin),
      optional("Code", list.ticker),
      text("Name", list.name),
      text("IsFond", bool(list.isFund)),
      ...rowElements(list.rows),
    ]),
  ]);
}

/**
 * The return as eDavki XML. Refuses a form with any issue: the caller shows
 * `validateDohKdvp`'s issues to the user first, and this is the safety net.
 */
export function writeDohKdvp(form: DohKdvp): string {
  const issues = validateDohKdvp(form);
  if (issues.length > 0) throw new FormValidationError("Doh-KDVP", issues);
  const year = String(form.taxYear);
  return serialize(
    element(
      "Envelope",
      [
        header(form.taxpayer),
        element("edp:AttachmentList"),
        element("edp:Signatures"),
        element("body", [
          element("edp:bodyContent"),
          element("Doh_KDVP", [
            element("KDVP", [
              text("DocumentWorkflowID", "O"),
              text("Year", year),
              text("PeriodStart", `${year}-01-01`),
              text("PeriodEnd", `${year}-12-31`),
              text("IsResident", "true"),
              optional("TelephoneNumber", form.taxpayer.phone),
              text("SecurityCount", String(form.lists.length)),
              text("SecurityShortCount", "0"),
              text("SecurityWithContractCount", "0"),
              text("SecurityWithContractShortCount", "0"),
              text("ShareCount", "0"),
              optional("Email", form.taxpayer.email),
            ]),
            ...form.lists.map(listElement),
          ]),
        ]),
      ],
      [
        ["xmlns", KDVP_NAMESPACE],
        ["xmlns:edp", EDP_NAMESPACE],
      ],
    ),
  );
}
