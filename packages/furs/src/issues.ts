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
  // Doh-KDVP
  | "noLists"
  | "duplicateList"
  | "isin"
  | "listWithoutPurchase"
  | "listWithoutSale"
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
