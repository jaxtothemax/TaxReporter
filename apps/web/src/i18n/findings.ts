/**
 * Every finding the engine can raise, as a sentence in each language: one
 * entry per code of @taxreporter/core's `DiagnosticParams`, so a new or
 * renamed code fails to compile until both languages say it (ADR 0011 §8).
 *
 * The parameters arrive ready to show: dates, amounts and percentages
 * formatted for the locale, a security as its symbol and ISIN, a file by the
 * name the user gave it, an event kind or a reason in words. A finding never
 * tells the user what to type into eDavki; it says what happened and what to
 * do about it in TaxReporter.
 */
import type {
  DiagnosticCode,
  DiagnosticParams,
  FileRefusal,
  KeyedEvent,
  UnreadableReason,
} from "@taxreporter/core";
import type { RateError } from "@taxreporter/fx";

/** A parameter as a sentence shows it: always text, optional where it was. */
export type Shown<P> = { readonly [K in keyof P]: string };

export type FindingMessages = {
  readonly [C in DiagnosticCode]: (p: Shown<DiagnosticParams[C]>) => string;
};

/** The words the sentences slot in for a code's closed lists. */
export interface FindingWords {
  /** A kind of event, as a plural noun. */
  readonly kinds: Readonly<Record<KeyedEvent["kind"], string>>;
  /** Why a file was refused, completing "This file …". */
  readonly refusals: Readonly<Record<FileRefusal, string>>;
  /** Why a file could not be read, after "This file cannot be read: ". */
  readonly unreadable: Readonly<Record<UnreadableReason, string>>;
  readonly rateErrors: Readonly<Record<RateError, string>>;
  readonly brokers: Readonly<Record<string, string>>;
  /**
   * Actions an adapter names in its own words rather than the export's, as
   * "FOREIGN_CURRENCY_TRADE" or IBKR's "shortSale"; a word followed by an
   * export's code ("corporateAction FI") is worded and keeps the code. An
   * export's own token, as BENEFITS_SAVEBACK, is shown as written.
   */
  readonly actions: Readonly<Record<string, string>>;
  /** A Flex Query section, as Interactive Brokers' own screens name it. */
  readonly sections: Readonly<
    Record<DiagnosticParams["summaryOnly"]["section"], string>
  >;
  /** Which of a trade's figures disagree, after "a trade's figures disagree: ". */
  readonly tradeChecks: Readonly<
    Record<DiagnosticParams["tradeInconsistent"]["check"], string>
  >;
}

/**
 * Where a file could not be read: "(sheet 2, cell B12)", "(sheet 2, row
 * 12)" or "(sheet 2)" in a workbook, "(line 12)" in a CSV or XML file, and
 * nothing for a file refused as a whole (row 0).
 */
function place(
  p: Shown<DiagnosticParams["unreadableFile"]>,
  words: {
    readonly line: string;
    readonly sheet: string;
    readonly row: string;
    readonly cell: string;
  },
): string {
  if (p.sheet === undefined) return line(p.row, words.line);
  if (p.row === "0") return ` (${words.sheet} ${p.sheet})`;
  return p.column === undefined
    ? ` (${words.sheet} ${p.sheet}, ${words.row} ${p.row})`
    : ` (${words.sheet} ${p.sheet}, ${words.cell} ${p.column}${p.row})`;
}

/** "(line 12)", or nothing for a file refused as a whole (row 0). */
function line(row: string, word: string): string {
  return row === "0" ? "" : ` (${word} ${row})`;
}

/**
 * The sentence led by where it happened, "AAPL (US…), 3 Mar 2026: …", from
 * whichever of the two a finding has; capitalized when it has neither.
 */
function at(
  p: { readonly isin?: string; readonly date?: string },
  sentence: string,
): string {
  const where = [p.isin, p.date].filter((part) => part !== undefined);
  return where.length === 0
    ? sentence.charAt(0).toUpperCase() + sentence.slice(1)
    : `${where.join(", ")}: ${sentence}`;
}

/**
 * Whether a form's rule broke on something typed on the Details step: the
 * taxpayer's details, a payer's, an income's country. That is the user's
 * to correct, not a fault to report. Paths come from the builders, never
 * from a file.
 */
const typedField = (path: string) =>
  /^taxpayer\.|\.payer\.|\.sourceCountry$/.test(path);

const REPORT_EN =
  "This is TaxReporter's fault, not your file's: please report it, without attaching the file.";

export const findingsEn: FindingMessages = {
  // The ledger
  tooManyEvents: (p) =>
    `Your files hold more than ${p.limit} transactions, more than TaxReporter reads in one go. Add fewer files at a time.`,
  sessionTooLarge: (p) =>
    `Your files together come to more than ${p.mebibytes} MiB, far more than any taxpayer's exports, so not all of them are read and no return is written. Leave out any file that is not a broker export.`,
  unknownEvent: () => `A transaction could not be used. ${REPORT_EN}`,
  invalidTrade: (p) => at(p, `a trade could not be used. ${REPORT_EN}`),
  invalidSplit: (p) => at(p, `a split could not be used. ${REPORT_EN}`),
  invalidDividend: (p) => at(p, `a dividend could not be used. ${REPORT_EN}`),
  invalidWithholding: (p) =>
    at(p, `a withheld tax could not be used. ${REPORT_EN}`),
  duplicatesRemoved: (p) =>
    `Transactions found in more than one of your files: ${p.count}. Each is counted once.`,
  duplicateKeyInFile: (p) =>
    at(
      p,
      `one file lists the same transaction twice. Export it again from your broker, unchanged.`,
    ),
  duplicateKeyConflict: (p) =>
    at(
      p,
      `two files describe the same transaction differently. Keep the export you trust and remove the other.`,
    ),
  overlapMismatch: (p) =>
    `${p.first} and ${p.second} cover the same days, ${p.from} to ${p.to}, but list different ${p.kind}. If they come from different accounts, say so in the account question. Otherwise one of them is incomplete: export it again.`,
  overlapKindMissing: (p) =>
    `${p.first} and ${p.second} cover the same days, ${p.from} to ${p.to}, but only one of them has ${p.kind}. The other was probably exported without them. Nothing is counted twice.`,
  accountsShareEvents: (p) =>
    `${p.first} and ${p.second} are set as different accounts, but they hold the same ${p.kind} (${p.count}). If they come from one account, say so in the account question, or those would count twice.`,
  fileIdClash: (p) =>
    `${p.file} and another file you added have the same fingerprint but different contents, which does not happen by chance. Neither is used: check where the files came from.`,
  // The FIFO engine
  splitReportsMerged: (p) =>
    at(p, `more than one account reports this split. It is applied once.`),
  splitConflict: (p) =>
    at(
      p,
      `two accounts report this split with different ratios. Check which export is right.`,
    ),
  splitDateAmbiguous: (p) =>
    at(
      p,
      `accounts date this split ${p.date} and ${p.until}, and a trade falls between the two dates, so it is unclear whether it was in shares before or after the split. Check that trade in your broker's records.`,
    ),
  tooManySplits: (p) =>
    `${p.isin}: more splits than any real history has. Check that the files were not altered.`,
  sameDayLotOrder: (p) =>
    at(
      p,
      `shares bought on ${p.purchased} at different prices have no time of day in the exports, so their order is not known. The order chosen decided which shares this sale used.`,
    ),
  zeroCostPurchase: (p) =>
    at(
      p,
      `shares received for nothing. Free shares can be income rather than a purchase: check how you got them.`,
    ),
  insufficientHistory: (p) =>
    at(
      p,
      `${p.missing} of the shares sold have no purchase in your files. Add the export that covers when you bought them.`,
    ),
  splitPositionMismatch: (p) =>
    at(
      p,
      `the broker says this split changed your number of shares by ${p.reported}, but its ratio, applied to the shares your files show at that broker, gives ${p.expected}. Nothing is restated on a guess: check that your files cover every purchase before the split.`,
    ),
  // The Doh-KDVP builder
  rateUnavailable: (p) =>
    `${p.currency} on ${p.date}: no Banka Slovenije rate is available, as ${p.reason}.`,
  rateDiffersFromEcb: (p) =>
    `${p.currency} on ${p.date}: Banka Slovenije published ${p.bsi}, which differs from the ECB's ${p.ecb}. The Banka Slovenije rate is used, as the law requires.`,
  exemptLotsLeftOut: (p) =>
    `${p.isin}: shares held 15 years or more (${p.quantity}) are left off the form. Their sale is not taxed.`,
  lossCounts: (p) =>
    at(
      p,
      `the loss reduces your gains, because you bought none in the 30 days before or after the sale.`,
    ),
  lossDisallowed: (p) =>
    at(
      p,
      `the loss does not reduce your gains, because you bought the same security within 30 days of the sale.`,
    ),
  lossPartlyDisallowed: (p) =>
    at(
      p,
      `part of the loss does not count, because shares were bought within 30 days of the sale (${p.replaced}).`,
    ),
  washSaleWindowOpen: (p) =>
    at(
      p,
      `whether the loss counts depends on purchases until ${p.until}, after your files end. The form leaves the question open; add a later export to settle it.`,
    ),
  splitAdjusted: (p) =>
    at(
      p,
      `quantities and prices before this date are restated for the ${p.ratio} split. Purchase dates stay the same.`,
    ),
  quantitiesRounded: (p) =>
    `${p.isin}: quantities are rounded to 8 decimal places, as the form requires.`,
  quantityTooSmall: (p) =>
    at(
      p,
      `a quantity rounds to zero at the form's 8 decimal places and is left out.`,
    ),
  formIssue: (p) =>
    typedField(p.path)
      ? `Something typed on the Details step is not what eDavki accepts (${p.code} at ${p.path}). Check the details there, then continue again.`
      : `The return would break a rule eDavki enforces (${p.code} at ${p.path}). ${REPORT_EN}`,
  // The Doh-Div builder
  withholdingWithoutDividend: (p) =>
    at(p, `tax was withheld, but your files have no dividend it belongs to.`),
  withholdingIsinMismatch: (p) =>
    at(
      p,
      `withheld tax names another security than its dividend. ${REPORT_EN}`,
    ),
  withholdingForOtherYear: (p) =>
    at(
      p,
      `this change to withheld tax belongs to the dividend of ${p.dividendDate}, so it goes on that year's return.`,
    ),
  dividendNotPositive: (p) =>
    at(p, `a dividend of zero or less cannot be filed. Check the export.`),
  foreignTaxNegative: (p) =>
    at(p, `more foreign tax was refunded than withheld. Check the export.`),
  payerUnknown: (p) =>
    `${p.isin}: Doh-Div needs the payer's name, address and country. Add them to file this dividend.`,
  sourceCountryUnknown: (p) =>
    `${p.isin}: the country the dividend comes from cannot be told from its ISIN. Add it with the payer's details.`,
  slovenianPayer: (p) =>
    at(
      p,
      `a Slovenian payer usually reports its dividends to FURS itself, so this one may not belong on your Doh-Div.`,
    ),
  payerIdIsIsin: (p) =>
    `${p.isin}: the payer's tax ID is not known, so the ISIN is written in its place, which eDavki accepts.`,
  treatyRateUnknown: (p) =>
    `${p.country}: TaxReporter does not know this tax treaty's rate yet, so the estimate credits foreign tax up to the Slovenian 25%. eDavki applies the treaty itself.`,
  excessWithholding: (p) =>
    at(
      p,
      `${p.country} withheld ${p.withheldEur}, but the tax treaty allows a credit of at most ${p.treatyRate}. Only ${p.creditEur} counts against Slovenian tax. You can reclaim the extra ${p.excessEur} from that country's tax authority.`,
    ),
  payerIdsNumbered: (p) =>
    `${p.date}: payments that share one payer ID (${p.count}) are numbered 1, 2, and so on, as FURS advises.`,
  // Intake and the broker adapters
  fileRefused: (p) => `This file ${p.reason}.`,
  unreadableFile: (p) =>
    `This file cannot be read: ${p.reason}${place(p, { line: "line", sheet: "sheet", row: "row", cell: "cell" })}. Export it again from your broker, unchanged.`,
  diagnosticsTruncated: (p) =>
    `More findings for this file are not shown (${p.dropped}).`,
  unknownFormat: () =>
    "TaxReporter does not recognize this export. It reads Trading 212 history CSV, Trade Republic transaction export CSV and Interactive Brokers Activity Flex Query XML for now; more brokers are coming.",
  ambiguousFormat: () =>
    "This export matches more than one known format, so it is not read.",
  derivativesNotSupported: (p) =>
    `${p.broker}: this export is from a CFD or other derivatives account. Derivatives go on the D-IFI return, which TaxReporter does not prepare yet.`,
  unknownColumn: (p) =>
    `${p.broker}: column ${p.position}, “${p.column}”, is one TaxReporter does not know, and it holds values that could change an amount. The file is not read; please report the column's name.`,
  unknownAction: (p) =>
    `${p.broker}: a row's action, “${p.action}”, is one TaxReporter does not know. It is not guessed at; please report it.`,
  unsupportedAction: (p) =>
    `${p.broker}: “${p.action}” rows are not supported yet, because their tax treatment is not settled. The return waits rather than guessing.`,
  unconfirmedAction: (p) =>
    `${p.broker}: “${p.action}” rows cannot be read yet: what this export's amounts mean on them is not yet confirmed against a real statement. The return waits rather than guessing; an anonymized export with such a row would settle it.`,
  invalidTime: () => "A row's date and time cannot be read.",
  dateMovedToLjubljana: (p) =>
    `A transaction at ${p.utcDate} in UTC fell on ${p.date} in Ljubljana. Slovenian dates are used.`,
  invalidIsin: () => "A row has no valid ISIN.",
  invalidNumber: (p) =>
    `A row's “${p.column}” is not a number TaxReporter reads.`,
  invalidQuantity: () => "A row's number of shares is missing or not positive.",
  invalidCurrency: () =>
    "A row's currency is not written the way TaxReporter reads it.",
  invalidPrice: () =>
    "A row's price is missing or zero. A sale at zero is usually a takeover paid in shares, which TaxReporter does not handle yet.",
  unexpectedSign: (p) => `A row's “${p.column}” has an unexpected sign.`,
  dividendTaxCurrency: () =>
    "A dividend's withheld tax is in a different currency from the dividend.",
  splitUnpaired: (p) => `${p.isin}: a split's two rows do not pair up.`,
  splitRatioUnclear: (p) =>
    at(p, `the split's ratio cannot be worked out exactly from its rows.`),
  splitHalvesDisagree: (p) =>
    at(p, `the split's two rows give the position different values.`),
  interestNotCovered: (p) =>
    `${p.broker}: interest rows (${p.count}) are not on these returns. Interest is filed on Doh-Obr, which TaxReporter does not prepare yet.`,
  derivativesNotCovered: (p) =>
    `${p.broker}: option, future, CFD and warrant trades (${p.count}) are not on these returns. Derivatives are filed on D-IFI, which TaxReporter does not prepare yet.`,
  // Interactive Brokers Flex statements
  statementCountMismatch: (p) =>
    `The file says it holds ${p.declared} statements, but ${p.found} are in it, so it was cut short or changed. Export it again from Interactive Brokers, unchanged.`,
  accountMismatch: () =>
    "A row names a different account from the statement it is in, so the file was changed or pieced together. Export it again from Interactive Brokers, unchanged.",
  accountIdInvalid: () =>
    "A statement is for an account TaxReporter does not read: only individual and joint Interactive Brokers accounts, whose number is U and digits, are supported.",
  paperAccount: () =>
    "This statement is from a paper trading account. Its trades were simulated and are not taxed: export the statement of your real account.",
  tooManyAccounts: (p) =>
    `The file holds statements for more accounts than TaxReporter reads at once (at most ${p.limit}). Export your own accounts only.`,
  unsupportedDateFormat: () =>
    "The file writes dates in a format TaxReporter does not read. In the Flex Query's settings, set the date format back to yyyyMMdd and export again.",
  statementPeriodInvalid: () =>
    "A statement's period cannot be right: it runs backwards, ends after the statement was made, or is longer than a year. Export it again from Interactive Brokers, unchanged.",
  rowAfterStatement: (p) =>
    at(
      p,
      `a row is dated after its statement was made, which a real statement cannot hold. Export it again from your broker, unchanged.`,
    ),
  unknownElement: (p) =>
    `The file has an element, “${p.element}”, that TaxReporter does not know. The file is not read rather than read in part; please report the element's name.`,
  unknownDetailLevel: (p) =>
    `A row's level of detail, “${p.level}”, is one TaxReporter does not know. It is not guessed at; please report it.`,
  summaryOnly: (p) =>
    `The statement's “${p.section}” section has totals only, no single transactions. In the Flex Query, choose its detail rows (Executions for Trades, Detail for Cash Transactions) and export again.`,
  withholdingUnlinked: (p) =>
    at(
      p,
      `tax was withheld, but its statement has no usable dividend of the same security, currency and day to join it to. It is not assigned on a guess. If it corrects tax on an earlier dividend, TaxReporter cannot read that yet; please report it.`,
    ),
  withholdingAmbiguous: (p) =>
    at(
      p,
      `tax was withheld, and more than one dividend of the same security, currency and day could be the one it belongs to. It is not assigned on a guess; please report it.`,
    ),
  dividendReversalUnmatched: (p) =>
    at(
      p,
      `a dividend is reversed, but its statement has no earlier dividend of that amount, with tax that cancels too, for the reversal to undo. It is not netted on a guess; please report it.`,
    ),
  tradeInconsistent: (p) =>
    at(
      p,
      `a trade's figures disagree: ${p.check}. It is not read on a guess: export the file again from your broker, unchanged, and if that does not help, please report it.`,
    ),
  fundFromName: (p) =>
    `${p.isin}: marked as a fund because its name says ETF or UCITS. Exports carry no fund flag.`,
};

export const wordsEn: FindingWords = {
  kinds: {
    trade: "trades",
    split: "splits",
    dividend: "dividends",
    withholding: "withheld tax",
  },
  refusals: {
    tooLarge: "is larger than any broker export (over 64 MiB)",
    zip: "is a ZIP archive, not a broker export: export CSV or XML from your broker instead",
    spreadsheet:
      "is an old Excel file: export CSV or XML from your broker instead",
    pdf: "is a PDF: export CSV or XML from your broker instead",
    gzip: "is compressed: export CSV or XML from your broker instead",
    utf16: "is UTF-16 text: export it again from your broker, unchanged",
    utf32: "is UTF-32 text: export it again from your broker, unchanged",
    binary: "contains binary data",
    notUtf8: "is not UTF-8 text: export it again from your broker, unchanged",
    macroWorkbook:
      "is an Excel workbook with macros, which TaxReporter never opens: export it again from your broker",
    binaryWorkbook:
      "is a binary Excel workbook (XLSB): export it again from your broker as XLSX",
    strictWorkbook:
      "is a Strict Open XML workbook: export it again from your broker, unchanged",
  },
  unreadable: {
    // CSV
    tooLarge: "the file is too large",
    tooManyRows: "it has too many rows",
    tooManyColumns: "it has too many columns",
    cellTooLong: "a cell is too long",
    unterminatedQuote: "a quoted cell is never closed",
    strayQuote: "a quote stands where none may",
    strayCarriageReturn: "a line break is broken",
    noHeader: "it has no header row",
    emptyHeaderName: "a column has no name",
    duplicateHeaderName: "two columns have the same name",
    rowLength: "a row has a different number of cells from the header",
    // XML
    declaration: "its XML declaration is not for UTF-8 XML 1.0",
    doctype:
      "it declares a document type (DOCTYPE), which TaxReporter never reads",
    processingInstruction: "it has a processing instruction",
    cdata: "it has a CDATA section",
    comment: "a comment is malformed",
    entity: "it refers to an entity XML does not define",
    characterReference: "a character reference names no allowed character",
    illegalCharacter: "it holds a character XML does not allow",
    name: "an element or attribute has a name no broker writes",
    namespace: "a namespace is used undeclared, or declared as XML forbids",
    duplicateAttribute: "an element has the same attribute twice",
    attributeSyntax: "an attribute is malformed",
    tooManyAttributes: "an element has too many attributes",
    valueTooLong: "a value is too long",
    lessThanInValue: "a value holds a “<”",
    text: "it has text outside its elements",
    cdataEnd: "its text holds “]]>”, which XML does not allow",
    mismatchedEnd: "an element is closed under another name",
    tooDeep: "its elements are nested too deep",
    tooManyElements: "it has too many elements",
    afterRoot: "something follows the end of the document",
    noRoot: "it holds no XML document",
    truncated: "it ends before its document does, so it was cut short",
    // ZIP, as XLSX workbooks are
    zipEnd: "its ZIP archive does not end as one must",
    zip64: "it is a ZIP64 archive, which no workbook needs",
    zipDisk: "it is one part of an archive split across disks",
    zipEntries: "its ZIP archive holds too many entries",
    zipDirectory: "its ZIP directory is malformed",
    zipHeader: "an entry's header disagrees with the ZIP directory",
    zipLayout: "its ZIP entries overlap, leave gaps or hide data",
    zipEncrypted: "it is encrypted",
    zipFlags: "an entry uses a ZIP option no workbook needs",
    zipMethod: "an entry is compressed in a way no workbook is",
    zipName: "an entry has a name no workbook uses",
    zipDuplicate: "two entries have the same name",
    zipExtra: "an entry carries extra data no workbook needs",
    zipBudget: "its parts would unpack to more than 64 MiB",
    zipStoredSize: "an uncompressed entry gives two sizes",
    zipInflate: "a compressed part is damaged",
    zipChecksum: "a part does not match its checksum, so it is damaged",
    zipDescriptor: "an entry's trailing sizes disagree with the ZIP directory",
    // XLSX
    xlsxPackage: "it is not laid out as an Excel workbook is",
    xlsxEncoding: "a part of it is not UTF-8 text",
    xlsxExternal: "a sheet is kept outside the file",
    xlsxWorkbook: "its list of sheets is malformed",
    xlsxSheets: "it has too many sheets",
    xlsxSheetName: "a sheet's name is blank, too long or repeated",
    xlsxStructure: "a sheet holds something no broker export has",
    xlsxReference: "a cell's place in its sheet is malformed or out of order",
    xlsxColumns: "a sheet has too many columns",
    xlsxRows: "its sheets have too many rows",
    xlsxCells: "its sheets have too many cells",
    xlsxSharedStrings: "its table of texts is malformed or too large",
    xlsxText: "a text in it is too long or malformed",
    xlsxCellType: "a cell holds a kind of value TaxReporter does not read",
    xlsxNumber: "a cell's number is malformed or out of range",
    xlsxFormula:
      "a cell holds a formula, which no broker writes, so it was edited",
  },
  rateErrors: {
    invalidDate: "the date cannot be read",
    metal: "it is a precious metal, not a currency",
    unknownCurrency: "Banka Slovenije does not publish it",
    beforeSnapshot: "the date is before the rates TaxReporter carries",
    afterSnapshot:
      "the date is after the rates TaxReporter carries; update TaxReporter",
    noRate: "Banka Slovenije published none for that day",
  },
  brokers: {
    trading212: "Trading 212",
    ibkr: "Interactive Brokers",
    traderepublic: "Trade Republic",
  },
  actions: {
    FOREIGN_CURRENCY_TRADE: "trades in a foreign currency",
    shortSale: "short sales",
    isinChange: "corporate actions that change an ISIN",
    returnOfCapital: "returns of capital",
    capitalGainDistribution: "capital gain distributions",
    interestDistribution: "interest distributions",
    partnershipDistribution: "partnership distributions",
    nonDividendDistribution: "non-dividend distributions",
    corporateAction: "corporate action",
    notes: "trades marked",
  },
  sections: {
    Trades: "Trades",
    CashTransactions: "Cash Transactions",
    CorporateActions: "Corporate Actions",
  },
  tradeChecks: {
    sign: "its buy or sell does not match the sign of its quantity",
    multiplier: "its multiplier is not 1, as a share's is",
    amount: "its value is not its quantity times its price",
    cusip: "its CUSIP does not match its ISIN",
  },
};

const REPORT_SL =
  "Napaka je v TaxReporterju, ne v vaši datoteki: sporočite jo, datoteke pa ne priložite.";

export const findingsSl: FindingMessages = {
  // The ledger
  tooManyEvents: (p) =>
    `Datoteke vsebujejo več kot ${p.limit} transakcij, kar je več, kot jih TaxReporter prebere naenkrat. Dodajte manj datotek hkrati.`,
  sessionTooLarge: (p) =>
    `Datoteke skupaj presegajo ${p.mebibytes} MiB, precej več kot izvozi katerega koli zavezanca, zato niso prebrane vse in napoved ni zapisana. Izpustite datoteke, ki niso izvozi posrednikov.`,
  unknownEvent: () => `Transakcije ni bilo mogoče uporabiti. ${REPORT_SL}`,
  invalidTrade: (p) => at(p, `posla ni bilo mogoče uporabiti. ${REPORT_SL}`),
  invalidSplit: (p) =>
    at(p, `razdelitve delnic ni bilo mogoče uporabiti. ${REPORT_SL}`),
  invalidDividend: (p) =>
    at(p, `dividende ni bilo mogoče uporabiti. ${REPORT_SL}`),
  invalidWithholding: (p) =>
    at(p, `odtegnjenega davka ni bilo mogoče uporabiti. ${REPORT_SL}`),
  duplicatesRemoved: (p) =>
    `Transakcije, ki se pojavijo v več datotekah: ${p.count}. Vsaka je upoštevana enkrat.`,
  duplicateKeyInFile: (p) =>
    at(
      p,
      `ista transakcija je v eni datoteki navedena dvakrat. Pri posredniku jo izvozite znova, nespremenjeno.`,
    ),
  duplicateKeyConflict: (p) =>
    at(
      p,
      `dve datoteki isto transakcijo opisujeta različno. Obdržite izvoz, ki mu zaupate, drugega pa odstranite.`,
    ),
  overlapMismatch: (p) =>
    `${p.first} in ${p.second} zajemata iste dni, od ${p.from} do ${p.to}, vendar se razlikujeta (${p.kind}). Če sta iz različnih računov, to označite pri vprašanju o računih. Sicer je eden od izvozov nepopoln: izvozite ga znova.`,
  overlapKindMissing: (p) =>
    `${p.first} in ${p.second} zajemata iste dni, od ${p.from} do ${p.to}, vendar ima samo ena od njiju tudi: ${p.kind}. Druga je bila verjetno izvožena brez njih. Nič ni upoštevano dvakrat.`,
  accountsShareEvents: (p) =>
    `${p.first} in ${p.second} sta označeni kot različna računa, vendar vsebujeta iste transakcije (${p.kind}: ${p.count}). Če sta iz enega računa, to označite pri vprašanju o računih, sicer bi se upoštevale dvakrat.`,
  fileIdClash: (p) =>
    `${p.file} ima enak prstni odtis kot druga dodana datoteka, a drugačno vsebino, kar se ne zgodi po naključju. Nobena ni uporabljena: preverite, od kod sta datoteki.`,
  // The FIFO engine
  splitReportsMerged: (p) =>
    at(p, `razdelitev navaja več računov. Upoštevana je enkrat.`),
  splitConflict: (p) =>
    at(
      p,
      `dva računa navajata razdelitev z različnim razmerjem. Preverite, kateri izvoz je pravilen.`,
    ),
  splitDateAmbiguous: (p) =>
    at(
      p,
      `računa razdelitev datirata ${p.date} in ${p.until}, med obema datumoma pa je posel, zato ni jasno, ali je bil sklenjen v delnicah pred razdelitvijo ali po njej. Preverite ta posel v evidenci posrednika.`,
    ),
  tooManySplits: (p) =>
    `${p.isin}: več razdelitev, kot jih ima katera koli resnična zgodovina. Preverite, ali datoteke niso bile spremenjene.`,
  sameDayLotOrder: (p) =>
    at(
      p,
      `delnice, kupljene ${p.purchased} po različnih cenah, v izvozih nimajo ure, zato njihov vrstni red ni znan. Izbrani vrstni red je določil, katere delnice so bile prodane.`,
    ),
  zeroCostPurchase: (p) =>
    at(
      p,
      `delnice, prejete brezplačno. Brezplačne delnice so lahko dohodek in ne nakup: preverite, kako ste jih dobili.`,
    ),
  insufficientHistory: (p) =>
    at(
      p,
      `za del prodanih delnic (${p.missing}) v datotekah ni nakupa. Dodajte izvoz, ki zajema čas, ko ste jih kupili.`,
    ),
  splitPositionMismatch: (p) =>
    at(
      p,
      `posrednik navaja, da se je število vaših delnic ob razdelitvi spremenilo za ${p.reported}, razmerje razdelitve pa za delnice, ki jih pri tem posredniku izkazujejo vaše datoteke, da ${p.expected}. Nič ni preračunano na slepo: preverite, ali datoteke zajemajo vse nakupe pred razdelitvijo.`,
    ),
  // The Doh-KDVP builder
  rateUnavailable: (p) =>
    `${p.currency}, ${p.date}: tečaj Banke Slovenije ni na voljo, ker ${p.reason}.`,
  rateDiffersFromEcb: (p) =>
    `${p.currency}, ${p.date}: Banka Slovenije je objavila ${p.bsi}, kar se razlikuje od tečaja ECB ${p.ecb}. Uporabljen je tečaj Banke Slovenije, kot zahteva zakon.`,
  exemptLotsLeftOut: (p) =>
    `${p.isin}: delnice, imete 15 let ali več (${p.quantity}), na obrazcu niso navedene. Njihova prodaja ni obdavčena.`,
  lossCounts: (p) =>
    at(
      p,
      `izguba zmanjša dobiček, ker v 30 dneh pred prodajo ali po njej niste kupili istega vrednostnega papirja.`,
    ),
  lossDisallowed: (p) =>
    at(
      p,
      `izguba ne zmanjša dobička, ker ste isti vrednostni papir kupili v 30 dneh od prodaje.`,
    ),
  lossPartlyDisallowed: (p) =>
    at(
      p,
      `del izgube se ne upošteva, ker ste v 30 dneh od prodaje kupili delnice (${p.replaced}).`,
    ),
  washSaleWindowOpen: (p) =>
    at(
      p,
      `ali se izguba upošteva, je odvisno od nakupov do ${p.until}, ko se vaše datoteke že končajo. Obrazec vprašanje pusti odprto; dodajte poznejši izvoz.`,
    ),
  splitAdjusted: (p) =>
    at(
      p,
      `količine in cene pred tem datumom so preračunane za razdelitev ${p.ratio}. Datumi nakupov ostanejo enaki.`,
    ),
  quantitiesRounded: (p) =>
    `${p.isin}: količine so zaokrožene na 8 decimalnih mest, kot zahteva obrazec.`,
  quantityTooSmall: (p) =>
    at(
      p,
      `količina se pri 8 decimalnih mestih zaokroži na nič in je izpuščena.`,
    ),
  formIssue: (p) =>
    typedField(p.path)
      ? `Nečesa, kar je vpisano v koraku s podatki, eDavki ne sprejmejo (${p.code}, ${p.path}). Preverite podatke tam in nato nadaljujte znova.`
      : `Napoved bi kršila pravilo, ki ga uveljavljajo eDavki (${p.code}, ${p.path}). ${REPORT_SL}`,
  // The Doh-Div builder
  withholdingWithoutDividend: (p) =>
    at(
      p,
      `davek je bil odtegnjen, vendar v datotekah ni dividende, ki ji pripada.`,
    ),
  withholdingIsinMismatch: (p) =>
    at(
      p,
      `odtegnjeni davek navaja drug vrednostni papir kot njegova dividenda. ${REPORT_SL}`,
    ),
  withholdingForOtherYear: (p) =>
    at(
      p,
      `ta sprememba odtegnjenega davka pripada dividendi z dne ${p.dividendDate}, zato spada v napoved za tisto leto.`,
    ),
  dividendNotPositive: (p) =>
    at(
      p,
      `dividende, ki ni večja od nič, ni mogoče prijaviti. Preverite izvoz.`,
    ),
  foreignTaxNegative: (p) =>
    at(
      p,
      `vrnjenega je bilo več tujega davka, kot ga je bilo odtegnjenega. Preverite izvoz.`,
    ),
  payerUnknown: (p) =>
    `${p.isin}: za Doh-Div so potrebni ime, naslov in država izplačevalca. Dodajte jih, da lahko dividendo prijavite.`,
  sourceCountryUnknown: (p) =>
    `${p.isin}: iz kode ISIN ni mogoče razbrati, iz katere države je dividenda. Dodajte jo s podatki o izplačevalcu.`,
  slovenianPayer: (p) =>
    at(
      p,
      `slovenski izplačevalec dividende običajno sam sporoči FURS, zato ta morda ne spada v vašo napoved Doh-Div.`,
    ),
  payerIdIsIsin: (p) =>
    `${p.isin}: davčna številka izplačevalca ni znana, zato je namesto nje vpisana koda ISIN, kar eDavki sprejmejo.`,
  treatyRateUnknown: (p) =>
    `${p.country}: TaxReporter stopnje iz te konvencije o izogibanju dvojnemu obdavčevanju še ne pozna, zato ocena upošteva tuji davek do slovenskih 25 %. eDavki konvencijo uporabijo sami.`,
  excessWithholding: (p) =>
    at(
      p,
      `v tujini (${p.country}) je bilo odtegnjenih ${p.withheldEur}, konvencija pa dovoljuje odbitek največ ${p.treatyRate}. Od slovenskega davka se odšteje le ${p.creditEur}. Presežek ${p.excessEur} lahko zahtevate nazaj od davčnega organa te države.`,
    ),
  payerIdsNumbered: (p) =>
    `${p.date}: plačila z isto identifikacijsko številko izplačevalca (${p.count}) so oštevilčena 1, 2 in tako naprej, kot svetuje FURS.`,
  // Intake and the broker adapters
  fileRefused: (p) => `Ta datoteka ${p.reason}.`,
  unreadableFile: (p) =>
    `Datoteke ni mogoče prebrati: ${p.reason}${place(p, { line: "vrstica", sheet: "list", row: "vrstica", cell: "celica" })}. Pri posredniku jo izvozite znova, nespremenjeno.`,
  diagnosticsTruncated: (p) =>
    `Nadaljnjih ugotovitev za to datoteko (${p.dropped}) ni prikazanih.`,
  unknownFormat: () =>
    "TaxReporter tega izvoza ne prepozna. Zaenkrat bere zgodovino Trading 212 v obliki CSV, izvoz transakcij Trade Republic v obliki CSV in poročila Activity Flex Query pri Interactive Brokers v obliki XML; drugi posredniki prihajajo.",
  ambiguousFormat: () => "Izvoz ustreza več znanim oblikam, zato ni prebran.",
  derivativesNotSupported: (p) =>
    `${p.broker}: izvoz je iz računa CFD ali drugih izvedenih finančnih instrumentov. Ti se prijavijo na obrazcu D-IFI, ki ga TaxReporter še ne pripravlja.`,
  unknownColumn: (p) =>
    `${p.broker}: stolpca ${p.position}, »${p.column}«, TaxReporter ne pozna, vsebuje pa vrednosti, ki bi lahko spremenile znesek. Datoteka ni prebrana; sporočite ime stolpca.`,
  unknownAction: (p) =>
    `${p.broker}: dejanja vrstice, »${p.action}«, TaxReporter ne pozna. Ne ugiba; sporočite ga.`,
  unsupportedAction: (p) =>
    `${p.broker}: vrstice »${p.action}« še niso podprte, ker njihova davčna obravnava ni urejena. Napoved počaka, namesto da bi ugibala.`,
  unconfirmedAction: (p) =>
    `${p.broker}: vrstic »${p.action}« še ni mogoče prebrati: pomen zneskov v njih v tem izvozu še ni potrjen na resničnem izpisku. Napoved počaka, namesto da bi ugibala; anonimiziran izvoz s takšno vrstico bi to razrešil.`,
  invalidTime: () => "Datuma in ure v vrstici ni mogoče prebrati.",
  dateMovedToLjubljana: (p) =>
    `Transakcija ob ${p.utcDate} po UTC je bila v Ljubljani ${p.date}. Uporabljeni so slovenski datumi.`,
  invalidIsin: () => "Vrstica nima veljavne kode ISIN.",
  invalidNumber: (p) =>
    `Vrednost »${p.column}« v vrstici ni število, ki ga TaxReporter bere.`,
  invalidQuantity: () => "Število delnic v vrstici manjka ali ni večje od nič.",
  invalidCurrency: () =>
    "Valuta v vrstici ni zapisana tako, kot jo TaxReporter bere.",
  invalidPrice: () =>
    "Cena v vrstici manjka ali je nič. Prodaja po ceni nič je običajno prevzem, plačan z delnicami, česar TaxReporter še ne obravnava.",
  unexpectedSign: (p) =>
    `Vrednost »${p.column}« v vrstici ima nepričakovan predznak.`,
  dividendTaxCurrency: () =>
    "Odtegnjeni davek dividende je v drugi valuti kot dividenda.",
  splitUnpaired: (p) =>
    `${p.isin}: vrstici razdelitve delnic se ne ujemata v par.`,
  splitRatioUnclear: (p) =>
    at(p, `razmerja razdelitve iz vrstic ni mogoče natančno določiti.`),
  splitHalvesDisagree: (p) =>
    at(p, `vrstici razdelitve navajata različno vrednost pozicije.`),
  interestNotCovered: (p) =>
    `${p.broker}: vrstice z obrestmi (${p.count}) niso v teh napovedih. Obresti se prijavijo na obrazcu Doh-Obr, ki ga TaxReporter še ne pripravlja.`,
  derivativesNotCovered: (p) =>
    `${p.broker}: posli z opcijami, terminskimi pogodbami, CFD in varanti (${p.count}) niso v teh napovedih. Izvedeni finančni instrumenti se prijavijo na obrazcu D-IFI, ki ga TaxReporter še ne pripravlja.`,
  // Interactive Brokers Flex statements
  statementCountMismatch: (p) =>
    `Število izpiskov, ki ga navaja datoteka (${p.declared}), se ne ujema s številom izpiskov v njej (${p.found}), zato je bila odrezana ali spremenjena. Pri Interactive Brokers jo izvozite znova, nespremenjeno.`,
  accountMismatch: () =>
    "Vrstica navaja drug račun kot izpisek, v katerem je, zato je bila datoteka spremenjena ali sestavljena iz več datotek. Pri Interactive Brokers jo izvozite znova, nespremenjeno.",
  accountIdInvalid: () =>
    "Izpisek je za račun, ki ga TaxReporter ne bere: podprti so samo osebni in skupni računi pri Interactive Brokers, katerih številka je črka U in števke.",
  paperAccount: () =>
    "Ta izpisek je iz demo računa (paper trading). Posli na njem so bili simulirani in niso obdavčeni: izvozite izpisek pravega računa.",
  tooManyAccounts: (p) =>
    `Datoteka vsebuje izpiske za več računov, kot jih TaxReporter prebere naenkrat (največ ${p.limit}). Izvozite samo svoje račune.`,
  unsupportedDateFormat: () =>
    "Datoteka zapisuje datume v obliki, ki je TaxReporter ne bere. V nastavitvah poročila Flex Query obliko datuma vrnite na yyyyMMdd in izvozite znova.",
  statementPeriodInvalid: () =>
    "Obdobje izpiska ne more biti pravilno: teče nazaj, konča se po nastanku izpiska ali je daljše od leta dni. Pri Interactive Brokers ga izvozite znova, nespremenjenega.",
  rowAfterStatement: (p) =>
    at(
      p,
      `vrstica je datirana po nastanku svojega izpiska, česar pravi izpisek ne more vsebovati. Pri posredniku ga izvozite znova, nespremenjenega.`,
    ),
  unknownElement: (p) =>
    `Datoteka vsebuje element »${p.element}«, ki ga TaxReporter ne pozna. Datoteka ni prebrana, namesto da bi bila prebrana le delno; sporočite ime elementa.`,
  unknownDetailLevel: (p) =>
    `Ravni podrobnosti v vrstici, »${p.level}«, TaxReporter ne pozna. Ne ugiba; sporočite jo.`,
  summaryOnly: (p) =>
    `Razdelek »${p.section}« v izpisku vsebuje le seštevke, ne posameznih transakcij. V poročilu Flex Query zanj izberite podrobne vrstice (Executions pri Trades, Detail pri Cash Transactions) in izvozite znova.`,
  withholdingUnlinked: (p) =>
    at(
      p,
      `davek je bil odtegnjen, vendar v njegovem izpisku ni uporabne dividende istega vrednostnega papirja, valute in dne, h kateri bi spadal. Ne pripiše se na slepo. Če popravlja davek od prejšnje dividende, ga TaxReporter še ne zna prebrati; sporočite to.`,
    ),
  withholdingAmbiguous: (p) =>
    at(
      p,
      `davek je bil odtegnjen, spadal pa bi lahko k več dividendam istega vrednostnega papirja, valute in dne. Ne pripiše se na slepo; sporočite to.`,
    ),
  dividendReversalUnmatched: (p) =>
    at(
      p,
      `dividenda je stornirana, vendar v njenem izpisku ni prejšnje dividende enakega zneska, katere davek bi se prav tako izničil, da bi jo storno razveljavil. Ne pobota se na slepo; sporočite to.`,
    ),
  tradeInconsistent: (p) =>
    at(
      p,
      `podatki posla se ne ujemajo: ${p.check}. Posel ni prebran na slepo: pri posredniku datoteko izvozite znova, nespremenjeno, in če to ne pomaga, nam to sporočite.`,
    ),
  fundFromName: (p) =>
    `${p.isin}: označen kot sklad, ker ime vsebuje ETF ali UCITS. Izvozi oznake sklada nimajo.`,
};

export const wordsSl: FindingWords = {
  kinds: {
    trade: "posli",
    split: "razdelitve delnic",
    dividend: "dividende",
    withholding: "odtegnjeni davek",
  },
  refusals: {
    tooLarge:
      "je večja od katerega koli izvoza borznega posrednika (več kot 64 MiB)",
    zip: "je arhiv ZIP, ne izvoz posrednika: pri posredniku raje izvozite CSV ali XML",
    spreadsheet:
      "je stara datoteka Excel: pri posredniku raje izvozite CSV ali XML",
    pdf: "je PDF: pri posredniku raje izvozite CSV ali XML",
    gzip: "je stisnjena: pri posredniku raje izvozite CSV ali XML",
    utf16:
      "je besedilo UTF-16: pri posredniku jo izvozite znova, nespremenjeno",
    utf32:
      "je besedilo UTF-32: pri posredniku jo izvozite znova, nespremenjeno",
    binary: "vsebuje binarne podatke",
    notUtf8:
      "ni besedilo UTF-8: pri posredniku jo izvozite znova, nespremenjeno",
    macroWorkbook:
      "je delovni zvezek Excel z makri, ki ga TaxReporter nikoli ne odpre: pri posredniku jo izvozite znova",
    binaryWorkbook:
      "je binarni delovni zvezek Excel (XLSB): pri posredniku jo izvozite znova kot XLSX",
    strictWorkbook:
      "je delovni zvezek Strict Open XML: pri posredniku jo izvozite znova, nespremenjeno",
  },
  unreadable: {
    // CSV
    tooLarge: "datoteka je prevelika",
    tooManyRows: "ima preveč vrstic",
    tooManyColumns: "ima preveč stolpcev",
    cellTooLong: "celica je predolga",
    unterminatedQuote: "celica v narekovajih ni zaključena",
    strayQuote: "narekovaj stoji, kjer ne sme",
    strayCarriageReturn: "prelom vrstice je pokvarjen",
    noHeader: "nima vrstice z imeni stolpcev",
    emptyHeaderName: "stolpec nima imena",
    duplicateHeaderName: "dva stolpca imata isto ime",
    rowLength: "vrstica ima drugačno število celic kot glava",
    // XML
    declaration: "njena deklaracija XML ni za XML 1.0 v UTF-8",
    doctype:
      "navaja vrsto dokumenta (DOCTYPE), ki je TaxReporter nikoli ne bere",
    processingInstruction: "vsebuje navodilo za obdelavo",
    cdata: "vsebuje razdelek CDATA",
    comment: "komentar je napačno zapisan",
    entity: "sklicuje se na entiteto, ki je XML ne določa",
    characterReference: "sklic na znak ne navaja dovoljenega znaka",
    illegalCharacter: "vsebuje znak, ki ga XML ne dovoljuje",
    name: "element ali atribut ima ime, ki ga noben posrednik ne zapiše",
    namespace:
      "imenski prostor je uporabljen nedeklariran ali deklariran, kot XML prepoveduje",
    duplicateAttribute: "element ima isti atribut dvakrat",
    attributeSyntax: "atribut je napačno zapisan",
    tooManyAttributes: "element ima preveč atributov",
    valueTooLong: "vrednost je predolga",
    lessThanInValue: "vrednost vsebuje znak »<«",
    text: "vsebuje besedilo zunaj elementov",
    cdataEnd: "njeno besedilo vsebuje »]]>«, česar XML ne dovoljuje",
    mismatchedEnd: "element je zaprt pod drugim imenom",
    tooDeep: "elementi so pregloboko vgnezdeni",
    tooManyElements: "ima preveč elementov",
    afterRoot: "za koncem dokumenta je še nekaj",
    noRoot: "ne vsebuje dokumenta XML",
    truncated: "konča se pred koncem dokumenta, zato je bila odrezana",
    // ZIP, kot so delovni zvezki XLSX
    zipEnd: "njen arhiv ZIP se ne konča, kot se mora",
    zip64: "je arhiv ZIP64, ki ga noben delovni zvezek ne potrebuje",
    zipDisk: "je del arhiva, razdeljenega na več diskov",
    zipEntries: "njen arhiv ZIP ima preveč vnosov",
    zipDirectory: "njen imenik ZIP je napačno zapisan",
    zipHeader: "glava vnosa se ne ujema z imenikom ZIP",
    zipLayout:
      "njeni vnosi ZIP se prekrivajo, puščajo vrzeli ali skrivajo podatke",
    zipEncrypted: "je šifrirana",
    zipFlags:
      "vnos uporablja možnost ZIP, ki je noben delovni zvezek ne potrebuje",
    zipMethod: "vnos je stisnjen drugače, kot je stisnjen delovni zvezek",
    zipName: "vnos ima ime, ki ga noben delovni zvezek ne uporablja",
    zipDuplicate: "dva vnosa imata isto ime",
    zipExtra:
      "vnos nosi dodatne podatke, ki jih noben delovni zvezek ne potrebuje",
    zipBudget: "njeni deli bi se razširili na več kot 64 MiB",
    zipStoredSize: "nestisnjen vnos navaja dve velikosti",
    zipInflate: "stisnjen del je poškodovan",
    zipChecksum: "del se ne ujema s svojo kontrolno vsoto, zato je poškodovan",
    zipDescriptor: "velikosti na koncu vnosa se ne ujemajo z imenikom ZIP",
    // XLSX
    xlsxPackage: "ni urejena, kot je urejen delovni zvezek Excel",
    xlsxEncoding: "del datoteke ni besedilo UTF-8",
    xlsxExternal: "list je shranjen zunaj datoteke",
    xlsxWorkbook: "njen seznam listov je napačno zapisan",
    xlsxSheets: "ima preveč listov",
    xlsxSheetName: "ime lista je prazno, predolgo ali se ponovi",
    xlsxStructure: "list vsebuje nekaj, česar noben izvoz posrednika nima",
    xlsxReference: "mesto celice na listu je napačno zapisano ali ni po vrsti",
    xlsxColumns: "list ima preveč stolpcev",
    xlsxRows: "njeni listi imajo preveč vrstic",
    xlsxCells: "njeni listi imajo preveč celic",
    xlsxSharedStrings: "njena tabela besedil je napačno zapisana ali prevelika",
    xlsxText: "besedilo v njej je predolgo ali napačno zapisano",
    xlsxCellType: "celica vsebuje vrsto vrednosti, ki je TaxReporter ne bere",
    xlsxNumber: "število v celici je napačno zapisano ali zunaj obsega",
    xlsxFormula:
      "celica vsebuje formulo, ki je noben posrednik ne zapiše, zato je bila datoteka urejena",
  },
  rateErrors: {
    invalidDate: "datuma ni mogoče prebrati",
    metal: "gre za plemenito kovino, ne valuto",
    unknownCurrency: "je Banka Slovenije ne objavlja",
    beforeSnapshot: "je datum pred tečaji, ki jih ima TaxReporter",
    afterSnapshot:
      "je datum po tečajih, ki jih ima TaxReporter; posodobite TaxReporter",
    noRate: "ga Banka Slovenije za ta dan ni objavila",
  },
  brokers: {
    trading212: "Trading 212",
    ibkr: "Interactive Brokers",
    traderepublic: "Trade Republic",
  },
  actions: {
    FOREIGN_CURRENCY_TRADE: "posli v tuji valuti",
    shortSale: "prodaje na kratko",
    isinChange: "korporacijska dejanja, ki spremenijo ISIN",
    returnOfCapital: "vračila kapitala",
    capitalGainDistribution: "izplačila kapitalskih dobičkov",
    interestDistribution: "izplačila obresti",
    partnershipDistribution: "izplačila komanditnih družb",
    nonDividendDistribution: "izplačila, ki niso dividende",
    corporateAction: "korporacijsko dejanje",
    notes: "posli z oznako",
  },
  // Interactive Brokers' screens are not in Slovenian: their own names.
  sections: {
    Trades: "Trades",
    CashTransactions: "Cash Transactions",
    CorporateActions: "Corporate Actions",
  },
  tradeChecks: {
    sign: "nakup ali prodaja se ne ujema s predznakom količine",
    multiplier: "množitelj ni 1, kot je pri delnici",
    amount: "vrednost ni enaka količini, pomnoženi s ceno",
    cusip: "koda CUSIP se ne ujema s kodo ISIN",
  },
};
