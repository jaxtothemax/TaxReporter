/**
 * Why a form cannot be written as it stands. The validators return these
 * before any XML exists, so the app can show them next to the figures they
 * concern; the writers refuse a form that has any.
 *
 * An issue carries a stable code and a path into the form model, never the
 * offending value: values include tax numbers, names and amounts, and none of
 * those may end up in an error message or a log (CLAUDE.md, "Privacy").
 */
export type FormIssueCode =
  // Both forms
  | "taxNumber"
  | "taxYear"
  | "invalidDate"
  | "invalidCharacter"
  | "textTooLong"
  | "textMissing"
  /** A hole or null in a list of lists, rows or dividends. */
  | "entryMissing"
  /** Lists, rows or dividends that are not an array. */
  | "notArray"
  /** An amount or quantity that is not a Decimal. */
  | "notDecimal"
  /** A flag that is not a boolean, such as the string "false". */
  | "notBoolean"
  // Doh-KDVP
  | "noLists"
  | "duplicateList"
  | "isin"
  /** Two lists with one name: the schema means names to be unique. */
  | "duplicateName"
  | "listWithoutPurchase"
  | "listWithoutSale"
  /** A row that is neither a purchase nor a sale. */
  | "rowKind"
  /** F2 outside the codes a foreign broker's data can need. */
  | "acquisitionMethod"
  /** F5 on an acquisition other than an inheritance (F) or gift (G). */
  | "inheritanceOrGiftTaxMethod"
  | "rowsNotChronological"
  | "purchaseAfterTaxYear"
  | "saleOutsideTaxYear"
  | "quantityNotPositive"
  | "quantityPrecision"
  | "quantityTooLarge"
  | "valueNegative"
  | "valueTooLarge"
  | "negativeBalance"
  | "balanceTooLarge"
  // Doh-Div
  | "noDividends"
  | "dividendOutsideTaxYear"
  | "valueNotPositive"
  | "foreignTaxMissing"
  | "foreignTaxForSlovenianPayer"
  | "foreignTaxAboveValue"
  | "payerTaxNumber"
  | "payerTaxNumberForForeignPayer"
  | "payerIdMissing"
  | "duplicatePayerId"
  | "country"
  | "dividendType";

export interface FormIssue {
  readonly code: FormIssueCode;
  /** Where in the form model, e.g. "lists[0].rows[3].quantity". */
  readonly path: string;
}

export type FormName = "Doh-KDVP" | "Doh-Div";

export class FormValidationError extends Error {
  constructor(
    readonly form: FormName,
    readonly issues: readonly FormIssue[],
  ) {
    super(
      `${form} cannot be written: ${issues
        .map((issue) => `${issue.code} at ${issue.path}`)
        .join("; ")}`,
    );
    this.name = "FormValidationError";
  }
}
