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
import type { CsvErrorCode } from "@taxreporter/brokers";
import type {
  DiagnosticCode,
  DiagnosticParams,
  FileRefusal,
  KeyedEvent,
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
  readonly csvErrors: Readonly<Record<CsvErrorCode, string>>;
  readonly rateErrors: Readonly<Record<RateError, string>>;
  readonly brokers: Readonly<Record<string, string>>;
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

const REPORT_EN =
  "This is TaxReporter's fault, not your file's: please report it, without attaching the file.";

export const findingsEn: FindingMessages = {
  // The ledger
  tooManyEvents: (p) =>
    `Your files hold more than ${p.limit} transactions, more than TaxReporter reads in one go. Add fewer files at a time.`,
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
    `The return would break a rule eDavki enforces (${p.code} at ${p.path}). ${REPORT_EN}`,
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
    `This file cannot be read as CSV: ${p.reason} (line ${p.row}). Export it again from your broker, unchanged.`,
  diagnosticsTruncated: (p) =>
    `More findings for this file are not shown (${p.dropped}).`,
  unknownFormat: () =>
    "TaxReporter does not recognize this export. It reads Trading 212 history CSV for now; more brokers are coming.",
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
    zip: "is a ZIP or Excel file: export CSV from your broker",
    spreadsheet: "is an old Excel file: export CSV from your broker",
    pdf: "is a PDF: export CSV from your broker",
    gzip: "is compressed: export CSV from your broker",
    utf16: "is UTF-16 text: export it again from your broker, unchanged",
    utf32: "is UTF-32 text: export it again from your broker, unchanged",
    binary: "contains binary data",
    notUtf8: "is not UTF-8 text: export it again from your broker, unchanged",
  },
  csvErrors: {
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
  brokers: { trading212: "Trading 212", ibkr: "Interactive Brokers" },
};

const REPORT_SL =
  "Napaka je v TaxReporterju, ne v vaši datoteki: sporočite jo, datoteke pa ne priložite.";

export const findingsSl: FindingMessages = {
  // The ledger
  tooManyEvents: (p) =>
    `Datoteke vsebujejo več kot ${p.limit} transakcij, kar je več, kot jih TaxReporter prebere naenkrat. Dodajte manj datotek hkrati.`,
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
    `Napoved bi kršila pravilo, ki ga uveljavljajo eDavki (${p.code}, ${p.path}). ${REPORT_SL}`,
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
    `Datoteke ni mogoče prebrati kot CSV: ${p.reason} (vrstica ${p.row}). Pri posredniku jo izvozite znova, nespremenjeno.`,
  diagnosticsTruncated: (p) =>
    `Nadaljnjih ugotovitev za to datoteko (${p.dropped}) ni prikazanih.`,
  unknownFormat: () =>
    "TaxReporter tega izvoza ne prepozna. Zaenkrat bere zgodovino Trading 212 v obliki CSV; drugi posredniki prihajajo.",
  ambiguousFormat: () => "Izvoz ustreza več znanim oblikam, zato ni prebran.",
  derivativesNotSupported: (p) =>
    `${p.broker}: izvoz je iz računa CFD ali drugih izvedenih finančnih instrumentov. Ti se prijavijo na obrazcu D-IFI, ki ga TaxReporter še ne pripravlja.`,
  unknownColumn: (p) =>
    `${p.broker}: stolpca ${p.position}, »${p.column}«, TaxReporter ne pozna, vsebuje pa vrednosti, ki bi lahko spremenile znesek. Datoteka ni prebrana; sporočite ime stolpca.`,
  unknownAction: (p) =>
    `${p.broker}: dejanja vrstice, »${p.action}«, TaxReporter ne pozna. Ne ugiba; sporočite ga.`,
  unsupportedAction: (p) =>
    `${p.broker}: vrstice »${p.action}« še niso podprte, ker njihova davčna obravnava ni urejena. Napoved počaka, namesto da bi ugibala.`,
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
    zip: "je datoteka ZIP ali Excel: pri posredniku izvozite CSV",
    spreadsheet: "je stara datoteka Excel: pri posredniku izvozite CSV",
    pdf: "je PDF: pri posredniku izvozite CSV",
    gzip: "je stisnjena: pri posredniku izvozite CSV",
    utf16:
      "je besedilo UTF-16: pri posredniku jo izvozite znova, nespremenjeno",
    utf32:
      "je besedilo UTF-32: pri posredniku jo izvozite znova, nespremenjeno",
    binary: "vsebuje binarne podatke",
    notUtf8:
      "ni besedilo UTF-8: pri posredniku jo izvozite znova, nespremenjeno",
  },
  csvErrors: {
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
  brokers: { trading212: "Trading 212", ibkr: "Interactive Brokers" },
};
