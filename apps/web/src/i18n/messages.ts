/**
 * Every user-visible string of the web app, in English and Slovenian.
 *
 * `en` defines the shape; `sl` is typed against it, so a key missing from one
 * language fails the type check. Parameterized messages are functions of
 * ALREADY FORMATTED strings: the components format numbers and dates for the
 * active locale first, so no message builds a number itself. Plurals are
 * `PluralForms` resolved with `plural()` (Slovenian has a dual and a "few").
 *
 * House style for copy: plain sentences, no em or en dashes (messages.test.ts
 * enforces it), and future tense for anything not built yet.
 */
import type { PluralForms } from "./format";

export interface Messages {
  readonly app: {
    readonly name: string;
    readonly skipToContent: string;
    readonly privacyBadge: string;
    readonly languageLabel: string;
    readonly languageNames: { readonly sl: string; readonly en: string };
    readonly homeLink: string;
    readonly footerNotAdvice: string;
    readonly footerSource: string;
    readonly footerRates: string;
    readonly footerLogos: string;
    readonly opensInNewTab: string;
    readonly themeLight: string;
    readonly crashed: string;
  };
  readonly brokers: { readonly trading212: string; readonly ibkr: string };
  readonly start: {
    readonly eyebrow: string;
    readonly title: string;
    readonly subtitle: string;
    readonly primaryCta: string;
    readonly secondaryCta: string;
    readonly highlights: readonly string[];
    readonly previewCaption: string;
    readonly previewSaleOn: (date: string) => string;
    readonly howTitle: string;
    readonly steps: readonly {
      readonly title: string;
      readonly body: string;
    }[];
    readonly privacyTitle: string;
    readonly privacyBody: string;
    readonly privacyLlm: string;
    readonly brokersTitle: string;
    readonly brokersNowLabel: string;
    readonly brokersNextLabel: string;
    readonly brokersNextNames: readonly string[];
    readonly brokersOthers: string;
  };
  readonly stepper: {
    readonly label: string;
    readonly files: string;
    readonly details: string;
    readonly review: string;
    readonly download: string;
    readonly done: string;
  };
  readonly demoBanner: { readonly title: string; readonly body: string };
  readonly nav: { readonly next: string; readonly back: string };
  readonly files: {
    readonly title: string;
    readonly intro: string;
    readonly taxYear: (year: string) => string;
    readonly dropTitle: string;
    readonly dropBody: string;
    readonly chooseButton: string;
    readonly demoButton: string;
    readonly listTitle: string;
    readonly emptyList: string;
    readonly remove: (name: string) => string;
    readonly reading: string;
    readonly readFailed: string;
    readonly readOnce: (name: string) => string;
    readonly clashed: string;
    readonly notRead: string;
    readonly noDatedRows: (broker: string, rows: string) => string;
    readonly stillReading: string;
    readonly problemsTitle: string;
    readonly problemsBody: string;
    readonly accountsTitle: string;
    readonly accountsBody: string;
    readonly accountsSame: string;
    readonly accountsSeparate: string;
    readonly announceReading: string;
    readonly announceRead: string;
    readonly announceFailed: string;
    readonly unsupported: string;
    readonly tooLarge: (limit: string) => string;
    readonly tooMuch: (limit: string) => string;
    readonly notAdded: PluralForms;
    readonly filesLimit: (limit: string) => string;
    readonly unsupportedBlocked: string;
    readonly announceAdded: PluralForms;
    readonly announceRemoved: (name: string) => string;
    readonly announceTotal: PluralForms;
    readonly announceDemo: string;
    readonly announceUnsupported: PluralForms;
    readonly rows: PluralForms;
    readonly coverage: (
      broker: string,
      from: string,
      to: string,
      rows: string,
    ) => string;
    readonly ownFilesNotice: string;
    readonly needFiles: string;
  };
  readonly details: {
    readonly title: string;
    readonly intro: string;
    readonly taxNumberLabel: string;
    readonly taxNumberHelp: string;
    readonly taxNumberError: string;
    readonly nameLabel: string;
    readonly addressLabel: string;
    readonly postCodeLabel: string;
    readonly cityLabel: string;
    readonly emailLabel: string;
    readonly emailHelp: string;
    readonly residentNote: string;
    readonly requiredNote: string;
    readonly requiredSuffix: string;
    readonly demoNote: string;
    readonly next: string;
    readonly asideTitle: string;
    readonly asidePoints: readonly string[];
    readonly previewTitle: string;
    readonly previewBody: string;
    readonly payersTitle: string;
    readonly payersIntro: string;
    readonly payments: PluralForms;
    readonly payerName: string;
    readonly payerAddress: string;
    readonly payerCountry: string;
    readonly payerId: string;
    readonly payerIdHelp: string;
    readonly payerTaxNumber: string;
    readonly payerTaxNumberHelp: string;
    readonly sourceCountry: string;
    readonly sourceCountryHelp: string;
    readonly countryChoose: string;
    readonly payersMissing: PluralForms;
  };
  readonly review: {
    readonly title: (year: string) => string;
    readonly intro: string;
    readonly salesLabel: string;
    readonly gainsTaxLabel: string;
    readonly dividendsLabel: string;
    readonly dividendsTaxLabel: string;
    readonly estimateNote: string;
    readonly estimateChip: string;
    readonly bucketsTitle: string;
    readonly byMonthTitle: string;
    readonly monthAmount: (month: string, amount: string) => string;
    readonly creditLabel: string;
    readonly dividendSplitTitle: (rate: string) => string;
    readonly stillDue: string;
    readonly showNotes: string;
    readonly tabsLabel: string;
    readonly tabGains: string;
    readonly tabGainsShort: string;
    readonly tabDividends: string;
    readonly tabDividendsShort: string;
    readonly tabNotes: (count: string) => string;
    readonly tabNotesShort: string;
    readonly colSold: string;
    readonly colProceeds: string;
    readonly colCost: string;
    readonly colGain: string;
    readonly showDetails: (symbol: string) => string;
    readonly rowsTitle: string;
    readonly colDate: string;
    readonly colType: string;
    readonly colQuantity: string;
    readonly colPrice: string;
    readonly colRate: string;
    readonly colEurPerUnit: string;
    readonly colSource: string;
    readonly purchase: string;
    readonly sale: string;
    readonly splitNote: (ratio: string, date: string) => string;
    readonly lotsTitle: string;
    readonly colBought: string;
    readonly colAcquisition: string;
    readonly colDisposal: string;
    readonly colHeld: string;
    readonly colBucket: string;
    readonly years: PluralForms;
    readonly estimateTitle: string;
    readonly positiveBucket: (rate: string) => string;
    readonly losses: string;
    readonly netBase: string;
    readonly allocatedBucket: (rate: string) => string;
    readonly estimatedTax: string;
    readonly rate: (rate: string, currency: string) => string;
    readonly rateList: (date: string) => string;
    readonly rateFixed: string;
    readonly rateMonthly: (month: string) => string;
    readonly rateInEur: string;
    readonly source: (file: string, row: string) => string;
    readonly sourceIn: (file: string, part: string, row: string) => string;
    readonly colPayer: string;
    readonly colCountry: string;
    readonly colGross: string;
    readonly colForeignTax: string;
    readonly colCredit: string;
    readonly creditCapped: (rate: string) => string;
    readonly dividendsTotal: string;
    readonly noneBlocking: string;
    readonly severity: {
      readonly blocking: string;
      readonly warning: string;
      readonly info: string;
    };
    readonly emptyTitle: string;
    readonly emptyBody: string;
    readonly noSales: string;
    readonly noDividends: string;
    readonly attention: PluralForms;
    readonly moreNotes: PluralForms;
    readonly blocked: string;
    readonly blockedOne: (form: string) => string;
    readonly preparing: string;
    readonly prepareFailed: string;
    readonly unnamedFile: string;
    readonly foreignTaxProof: string;
  };
  readonly download: {
    readonly title: string;
    readonly intro: (deadline: string) => string;
    readonly due: (deadline: string) => string;
    readonly preparingChip: string;
    readonly readyChip: string;
    readonly notWrittenChip: string;
    readonly kdvpTitle: string;
    readonly kdvpBody: PluralForms;
    /** A withheld Doh-KDVP with no list to count. */
    readonly kdvpNone: string;
    readonly divTitle: string;
    readonly divBody: PluralForms;
    /** A withheld Doh-Div with no payment to count. */
    readonly divNone: string;
    readonly downloadButton: (form: string) => string;
    readonly preparing: string;
    readonly demoFiles: string;
    readonly ownFiles: string;
    readonly notWritten: PluralForms;
    readonly failed: string;
    readonly importTitle: string;
    readonly nothingToFile: string;
    readonly importSteps: (
      deadline: string,
      forms: number,
    ) => readonly string[];
    readonly startOver: string;
  };
}

export const en: Messages = {
  app: {
    name: "TaxReporter",
    skipToContent: "Skip to content",
    privacyBadge: "Your files stay on this device",
    languageLabel: "Language",
    languageNames: { sl: "Slovenščina", en: "English" },
    homeLink: "TaxReporter, start page",
    footerNotAdvice:
      "TaxReporter prepares a return for you to review. It is not tax advice and is not affiliated with FURS.",
    footerSource: "Source code (AGPL-3.0)",
    footerRates: "Exchange rates: Banka Slovenije, CC BY 4.0",
    footerLogos: "Company logos are trademarks of their owners.",
    opensInNewTab: "(opens in a new tab)",
    themeLight: "Light theme",
    crashed:
      "Something went wrong showing this step. Nothing was sent anywhere. Go back, or start over.",
  },
  brokers: { trading212: "Trading 212", ibkr: "Interactive Brokers" },
  start: {
    eyebrow: "Preview with demo data",
    title: "Doh-KDVP and Doh-Div from your broker's exports",
    subtitle:
      "Every amount at the Banka Slovenije rate, lots matched first in, first out across brokers, and all of it prepared on your own computer.",
    primaryCta: "Explore the demo",
    secondaryCta: "Use my files",
    highlights: [
      "Banka Slovenije rates",
      "FIFO across brokers",
      "Files never leave this device",
    ],
    previewCaption:
      "Every converted amount shows the Banka Slovenije rate behind it.",
    previewSaleOn: (date) => `Sale, ${date}`,
    howTitle: "How it works",
    steps: [
      {
        title: "Add your exports",
        body: "Trading 212 CSV and Interactive Brokers Flex Query XML first. Add every year back to your oldest open purchase.",
      },
      {
        title: "Check your details",
        body: "Your tax number and address go into the XML header and nowhere else.",
      },
      {
        title: "Review every figure",
        body: "Each purchase, sale and dividend with its exchange rate, its source row and any warning.",
      },
      {
        title: "Import into eDavki",
        body: "Download the XML, open Dokumenti, then Uvoz in eDavki, and check the form before you submit it.",
      },
    ],
    privacyTitle: "What happens to your files",
    privacyBody:
      "They are read in this browser tab and never uploaded. There is no account and no tracking. Closing the tab clears everything.",
    privacyLlm:
      "An optional AI check is planned. It will only run with your own API key, after you have seen exactly what it sends.",
    brokersTitle: "Brokers",
    brokersNowLabel: "Being built for v0.1",
    brokersNextLabel: "Planned after v0.1",
    brokersNextNames: ["eToro", "Revolut", "Robinhood", "DEGIRO"],
    brokersOthers: "and others",
  },
  stepper: {
    label: "Progress",
    files: "Files",
    details: "Details",
    review: "Review",
    download: "Download",
    done: "completed",
  },
  demoBanner: {
    title: "Demo data.",
    body: "These trades and dividends are made up, but the exchange rates are real Banka Slovenije rates.",
  },
  nav: { next: "Continue", back: "Back" },
  files: {
    title: "Add your broker exports",
    intro:
      "Add every export that covers a security you sold this year, back to its oldest purchase. FIFO matches purchases and sales across all of them together.",
    taxYear: (year) => `Tax year ${year}`,
    dropTitle: "Drop files here",
    dropBody:
      "CSV from Trading 212, XML from an Interactive Brokers Flex Query",
    chooseButton: "Choose files",
    demoButton: "Use demo files",
    listTitle: "Added files",
    emptyList: "No files added yet.",
    remove: (name) => `Remove ${name}`,
    reading: "Reading the file",
    readFailed:
      "Your files could not be read. Remove the last file you added, or reload the page; nothing was sent anywhere.",
    readOnce: (name) => `The same file as ${name}, so it is read once.`,
    clashed:
      "Has the fingerprint of another file but different contents, so neither is read.",
    notRead:
      "Not read: your files hold more transactions than TaxReporter reads at once.",
    noDatedRows: (broker, rows) => `${broker}, ${rows}`,
    stillReading: "Wait until your files are read.",
    problemsTitle: "Problems in your files",
    problemsBody:
      "Until these are fixed, the returns are not written. You can still continue and look at the review.",
    accountsTitle: "Are these Trading 212 files from one account?",
    accountsBody:
      "Trading 212 exports do not say which account they come from. Overlapping files of one account are read once; files of separate accounts are all counted.",
    accountsSame: "Yes, one account",
    accountsSeparate: "No, separate accounts",
    announceReading: "Reading your files.",
    announceRead: "Your files are read.",
    announceFailed: "Your files could not be read.",
    unsupported: "Not a CSV or XML export. Remove it to continue.",
    tooLarge: (limit) =>
      `Larger than any broker export (over ${limit}), so it is not read. Remove it to continue.`,
    tooMuch: (limit) =>
      `With it, your files would come to more than ${limit}, more than TaxReporter reads at once, so it is not read. Remove it, or a larger file, and add it again.`,
    notAdded: {
      one: "{n} file was not added.",
      other: "{n} files were not added.",
    },
    filesLimit: (limit) => `TaxReporter reads at most ${limit} files at once.`,
    unsupportedBlocked: "Remove the files TaxReporter cannot read to continue.",
    announceAdded: { one: "{n} file added.", other: "{n} files added." },
    announceRemoved: (name) => `${name} removed.`,
    announceTotal: {
      one: "{n} file in the list.",
      other: "{n} files in the list.",
    },
    announceDemo: "The two demo exports were added.",
    announceUnsupported: {
      one: "{n} of them is not a CSV or XML export.",
      other: "{n} of them are not CSV or XML exports.",
    },
    rows: { one: "{n} row", other: "{n} rows" },
    coverage: (broker, from, to, rows) =>
      `${broker}, ${from} to ${to}, ${rows}`,
    ownFilesNotice:
      "Your files are read in this browser tab and never uploaded.",
    needFiles: "Add at least one file to continue.",
  },
  details: {
    title: "Your details",
    intro:
      "FURS needs these in the XML header. They stay in this tab's memory and are cleared when you close it.",
    taxNumberLabel: "Tax number (davčna številka)",
    taxNumberHelp: "8 digits",
    taxNumberError: "Enter the 8 digits of your tax number.",
    nameLabel: "Full name",
    addressLabel: "Street and house number",
    postCodeLabel: "Post code",
    cityLabel: "Town",
    emailLabel: "Email (optional)",
    emailHelp:
      "Only if you want FURS to be able to contact you about this return.",
    residentNote:
      "TaxReporter prepares returns for Slovenian tax residents only.",
    requiredNote: "Only the tax number is required.",
    requiredSuffix: "(required)",
    demoNote: "Not required in the demo.",
    next: "Review results",
    asideTitle: "What happens to your details",
    asidePoints: [
      "They go into the XML header and nowhere else.",
      "They are not sent anywhere: the file is made in this tab.",
      "Closing the tab clears them. Nothing is saved.",
    ],
    previewTitle: "In the XML file",
    previewBody:
      "The header of each return, as you type. Empty fields are left out.",
    payersTitle: "Who paid your dividends",
    payersIntro:
      "Doh-Div needs each payer's name, address and country. TaxReporter does not look them up online, as that would tell a server what you own: the company's annual report or website gives its address.",
    payments: {
      one: "{n} payment this year",
      other: "{n} payments this year",
    },
    payerName: "Payer's name",
    payerAddress: "Payer's address",
    payerCountry: "Payer's country",
    payerTaxNumber: "Payer's tax number",
    payerTaxNumberHelp:
      "A Slovenian payer is named by its 8-digit tax number, which Doh-Div needs.",
    payerId: "Payer's tax ID (optional)",
    payerIdHelp:
      "Left empty, the ISIN is written in its place, which eDavki accepts.",
    sourceCountry: "Country the income comes from",
    sourceCountryHelp: "The ISIN does not say.",
    countryChoose: "Choose a country",
    payersMissing: {
      one: "{n} payer still needs its details. Until then, Doh-Div is not written; Doh-KDVP is.",
      other:
        "{n} payers still need their details. Until then, Doh-Div is not written; Doh-KDVP is.",
    },
  },
  review: {
    title: (year) => `Review tax year ${year}`,
    intro:
      "Check every figure before you download. TaxReporter prepares the return; eDavki calculates the final tax.",
    salesLabel: "Securities sold",
    gainsTaxLabel: "Estimated tax on gains",
    dividendsLabel: "Dividends received",
    dividendsTaxLabel: "Estimated tax still due on dividends",
    estimateNote:
      "Estimates only. The tax in your assessment comes from eDavki.",
    estimateChip: "Estimate",
    bucketsTitle: "Net taxable gain by tax rate",
    byMonthTitle: "Dividends by month",
    monthAmount: (month, amount) => `${month}: ${amount}`,
    creditLabel: "Foreign tax credit",
    dividendSplitTitle: (rate) => `Slovenian tax at ${rate}`,
    stillDue: "Still due",
    showNotes: "Show notes",
    tabsLabel: "Forms and notes",
    tabGains: "Gains (Doh-KDVP)",
    tabGainsShort: "Gains",
    tabDividends: "Dividends (Doh-Div)",
    tabDividendsShort: "Dividends",
    tabNotes: (count) => `Notes (${count})`,
    tabNotesShort: "Notes",
    colSold: "Sold",
    colProceeds: "Proceeds",
    colCost: "Cost",
    colGain: "Gain or loss",
    showDetails: (symbol) => `${symbol}: inventory list and matched lots`,
    rowsTitle: "Inventory list (popisni list)",
    colDate: "Date",
    colType: "Type",
    colQuantity: "Quantity",
    colPrice: "Price",
    colRate: "Exchange rate",
    colEurPerUnit: "EUR per unit",
    colSource: "Source",
    purchase: "Purchase",
    sale: "Sale",
    splitNote: (ratio, date) => `Adjusted for the ${ratio} split of ${date}`,
    lotsTitle: "Matched lots, first in, first out",
    colBought: "Bought",
    colAcquisition: "Cost",
    colDisposal: "Proceeds",
    colHeld: "Held",
    colBucket: "Tax rate",
    years: { one: "{n} year", other: "{n} years" },
    estimateTitle: "How the gains estimate is built",
    positiveBucket: (rate) => `Gains taxed at ${rate}, after normed costs`,
    losses: "Losses of the same year",
    netBase: "Net taxable gain",
    allocatedBucket: (rate) => `Share taxed at ${rate}`,
    estimatedTax: "Estimated tax",
    rate: (rate, currency) => `1 EUR = ${rate} ${currency}`,
    rateList: (date) => `BSI list of ${date}`,
    rateFixed: "Fixed euro conversion rate",
    rateMonthly: (month) => `BSI monthly list of ${month}`,
    rateInEur: "Already in EUR",
    source: (file, row) => `${file}, row ${row}`,
    sourceIn: (file, part, row) => `${file}, ${part}, row ${row}`,
    colPayer: "Payer",
    colCountry: "Country",
    colGross: "Gross",
    colForeignTax: "Tax withheld",
    colCredit: "Credit",
    creditCapped: (rate) => `Credit capped at the treaty rate of ${rate}`,
    dividendsTotal: "Total",
    noneBlocking: "Nothing blocks the download.",
    severity: {
      blocking: "Fix before you download",
      warning: "Check these",
      info: "For your information",
    },
    emptyTitle: "Nothing to review yet",
    emptyBody:
      "Add your broker exports to see your returns here, or explore the review with the demo data.",
    noSales:
      "No securities were sold in this tax year, so there is no Doh-KDVP to file.",
    noDividends: "No dividends were paid in this tax year.",
    attention: {
      one: "{n} note needs your attention before you download.",
      other: "{n} notes need your attention before you download.",
    },
    moreNotes: {
      one: "{n} more note is not shown.",
      other: "{n} more notes are not shown.",
    },
    blocked: "Fix the notes that stop the returns before you continue.",
    blockedOne: (form) =>
      `${form} is not written until the notes that stop it are fixed. You can continue with the other return.`,
    preparing:
      "Working out your returns from your files, at Banka Slovenije rates.",
    prepareFailed:
      "Your returns could not be worked out. Go back and continue again, or reload the page; nothing was sent anywhere.",
    unnamedFile: "a file",
    foreignTaxProof:
      "FURS can ask for proof that foreign tax was finally paid. Keep your brokers' annual statements.",
  },
  download: {
    title: "Download and import",
    intro: (deadline) =>
      `Import each file into eDavki, check the form, and submit it by ${deadline}.`,
    due: (deadline) => `Due ${deadline}`,
    preparingChip: "Preparing",
    readyChip: "Ready",
    notWrittenChip: "Not written",
    kdvpTitle: "Doh-KDVP",
    kdvpBody: {
      one: "Gains from selling securities: {n} inventory list.",
      other: "Gains from selling securities: {n} inventory lists.",
    },
    kdvpNone: "Gains from selling securities: no inventory list could be made.",
    divTitle: "Doh-Div",
    divBody: {
      one: "Dividends: {n} payment.",
      other: "Dividends: {n} payments.",
    },
    divNone: "Dividends: no payment could be listed.",
    downloadButton: (form) => `Download ${form}`,
    preparing:
      "Writing the files from the trades and dividends, at Banka Slovenije rates.",
    demoFiles:
      "These files hold the demo's made-up trades for a made-up taxpayer, tax number 12345678. They are written exactly as yours are, so you can see what eDavki receives, but do not import them into eDavki.",
    ownFiles:
      "Check each form against the review before you submit it in eDavki. TaxReporter prepares the returns; filing them is up to you.",
    notWritten: {
      one: "Not written: {n} problem in the review must be fixed first.",
      other: "Not written: {n} problems in the review must be fixed first.",
    },
    failed:
      "The files could not be written. Reload the page to try again; nothing was sent anywhere.",
    importTitle: "Importing into eDavki",
    nothingToFile:
      "No securities were sold and no dividends were paid in this tax year, so there is nothing to file.",
    importSteps: (deadline, forms) => [
      "Log in to eDavki.",
      "Open Dokumenti, then Uvoz, and choose the file.",
      "Open the imported form and compare it with this review.",
      forms > 1
        ? `Submit it by ${deadline}, then repeat for the second file.`
        : `Submit it by ${deadline}.`,
    ],
    startOver: "Start over",
  },
};

export const sl: Messages = {
  app: {
    name: "TaxReporter",
    skipToContent: "Preskoči na vsebino",
    privacyBadge: "Datoteke ostanejo na tej napravi",
    languageLabel: "Jezik",
    languageNames: { sl: "Slovenščina", en: "English" },
    homeLink: "TaxReporter, začetna stran",
    footerNotAdvice:
      "TaxReporter pripravi napoved, ki jo pregledate sami. Ni davčni nasvet in ni povezan s FURS.",
    footerSource: "Izvorna koda (AGPL-3.0)",
    footerRates: "Tečaji: Banka Slovenije, CC BY 4.0",
    footerLogos: "Logotipi podjetij so blagovne znamke njihovih lastnikov.",
    opensInNewTab: "(odpre se v novem zavihku)",
    themeLight: "Svetla tema",
    crashed:
      "Pri prikazu tega koraka je šlo nekaj narobe. Nič ni bilo nikamor poslano. Vrnite se ali začnite znova.",
  },
  brokers: { trading212: "Trading 212", ibkr: "Interactive Brokers" },
  start: {
    eyebrow: "Predogled z demo podatki",
    title: "Doh-KDVP in Doh-Div iz izvozov vašega borznega posrednika",
    subtitle:
      "Vsak znesek po tečaju Banke Slovenije, nakupi povezani po metodi FIFO prek vseh posrednikov, vse pripravljeno na vašem računalniku.",
    primaryCta: "Preizkusi demo",
    secondaryCta: "Uporabi svoje datoteke",
    highlights: [
      "Tečaji Banke Slovenije",
      "FIFO prek vseh posrednikov",
      "Datoteke ne zapustijo naprave",
    ],
    previewCaption:
      "Pri vsakem preračunanem znesku je viden tečaj Banke Slovenije, ki je bil uporabljen.",
    previewSaleOn: (date) => `Prodaja, ${date}`,
    howTitle: "Kako deluje",
    steps: [
      {
        title: "Dodajte izvoze",
        body: "Najprej CSV iz Trading 212 in XML iz poročila Flex Query pri Interactive Brokers. Dodajte vsa leta do najstarejšega odprtega nakupa.",
      },
      {
        title: "Preverite podatke",
        body: "Davčna številka in naslov gresta samo v glavo datoteke XML.",
      },
      {
        title: "Preglejte vsako številko",
        body: "Vsak nakup, prodaja in dividenda s tečajem, vrstico vira in morebitnim opozorilom.",
      },
      {
        title: "Uvozite v eDavke",
        body: "Prenesite XML, v eDavkih odprite Dokumenti, nato Uvoz, in pred oddajo preverite obrazec.",
      },
    ],
    privacyTitle: "Kaj se zgodi z datotekami",
    privacyBody:
      "Preberejo se v tem zavihku brskalnika in se nikamor ne naložijo. Ni računa in ni sledenja. Ko zaprete zavihek, se vse izbriše.",
    privacyLlm:
      "Načrtujemo izbirno preverjanje z umetno inteligenco. Delovalo bo le z vašim ključem API in šele, ko boste videli, kaj točno pošlje.",
    brokersTitle: "Borzni posredniki",
    brokersNowLabel: "V izdelavi za v0.1",
    brokersNextLabel: "Načrtovano po v0.1",
    brokersNextNames: ["eToro", "Revolut", "Robinhood", "DEGIRO"],
    brokersOthers: "in drugi",
  },
  stepper: {
    label: "Napredek",
    files: "Datoteke",
    details: "Podatki",
    review: "Pregled",
    download: "Prenos",
    done: "končano",
  },
  demoBanner: {
    title: "Demo podatki.",
    body: "Posli in dividende so izmišljeni, tečaji pa so pravi tečaji Banke Slovenije.",
  },
  nav: { next: "Naprej", back: "Nazaj" },
  files: {
    title: "Dodajte izvoze borznih posrednikov",
    intro:
      "Dodajte vse izvoze za vrednostne papirje, ki ste jih letos prodali, vse do njihovega najstarejšega nakupa. Metoda FIFO poveže nakupe in prodaje iz vseh izvozov skupaj.",
    taxYear: (year) => `Davčno leto ${year}`,
    dropTitle: "Spustite datoteke sem",
    dropBody:
      "CSV iz Trading 212, XML iz poročila Flex Query pri Interactive Brokers",
    chooseButton: "Izberi datoteke",
    demoButton: "Uporabi demo datoteke",
    listTitle: "Dodane datoteke",
    emptyList: "Dodali še niste nobene datoteke.",
    remove: (name) => `Odstrani ${name}`,
    reading: "Branje datoteke",
    readFailed:
      "Datotek ni bilo mogoče prebrati. Odstranite zadnjo dodano datoteko ali znova naložite stran; nič ni bilo nikamor poslano.",
    readOnce: (name) => `Ista datoteka kot ${name}, zato je prebrana enkrat.`,
    clashed:
      "Ima prstni odtis druge datoteke, a drugačno vsebino, zato ni prebrana nobena.",
    notRead:
      "Ni prebrana: datoteke vsebujejo več transakcij, kot jih TaxReporter prebere naenkrat.",
    noDatedRows: (broker, rows) => `${broker}, ${rows}`,
    stillReading: "Počakajte, da bodo datoteke prebrane.",
    problemsTitle: "Težave v vaših datotekah",
    problemsBody:
      "Dokler niso odpravljene, napovedi niso zapisane. Pregled si lahko vseeno ogledate.",
    accountsTitle: "Ali so te datoteke Trading 212 iz enega računa?",
    accountsBody:
      "Izvozi Trading 212 ne navajajo, iz katerega računa so. Datoteke istega računa, ki se prekrivajo, so prebrane enkrat; datoteke ločenih računov se upoštevajo vse.",
    accountsSame: "Da, en račun",
    accountsSeparate: "Ne, ločeni računi",
    announceReading: "Branje datotek.",
    announceRead: "Datoteke so prebrane.",
    announceFailed: "Datotek ni bilo mogoče prebrati.",
    unsupported: "To ni izvoz CSV ali XML. Za nadaljevanje ga odstranite.",
    tooLarge: (limit) =>
      `Večja je od katerega koli izvoza posrednika (več kot ${limit}), zato ni prebrana. Za nadaljevanje jo odstranite.`,
    tooMuch: (limit) =>
      `Z njo bi vaše datoteke skupaj presegle ${limit}, kolikor jih TaxReporter prebere naenkrat, zato ni prebrana. Odstranite njo ali večjo datoteko in jo dodajte znova.`,
    notAdded: {
      one: "{n} datoteka ni bila dodana.",
      two: "{n} datoteki nista bili dodani.",
      few: "{n} datoteke niso bile dodane.",
      other: "{n} datotek ni bilo dodanih.",
    },
    filesLimit: (limit) =>
      `TaxReporter prebere največ ${limit} datotek naenkrat.`,
    unsupportedBlocked:
      "Za nadaljevanje odstranite datoteke, ki jih TaxReporter ne more prebrati.",
    announceAdded: {
      one: "Dodana je {n} datoteka.",
      two: "Dodani sta {n} datoteki.",
      few: "Dodane so {n} datoteke.",
      other: "Dodanih je {n} datotek.",
    },
    announceRemoved: (name) => `Datoteka ${name} je odstranjena.`,
    announceTotal: {
      one: "Na seznamu je {n} datoteka.",
      two: "Na seznamu sta {n} datoteki.",
      few: "Na seznamu so {n} datoteke.",
      other: "Na seznamu je {n} datotek.",
    },
    announceDemo: "Dodana sta oba demo izvoza.",
    announceUnsupported: {
      one: "{n} izmed njih ni izvoz CSV ali XML.",
      two: "{n} izmed njih nista izvoza CSV ali XML.",
      few: "{n} izmed njih niso izvozi CSV ali XML.",
      other: "{n} izmed njih ni izvozov CSV ali XML.",
    },
    rows: {
      one: "{n} vrstica",
      two: "{n} vrstici",
      few: "{n} vrstice",
      other: "{n} vrstic",
    },
    coverage: (broker, from, to, rows) =>
      `${broker}, od ${from} do ${to}, ${rows}`,
    ownFilesNotice:
      "Datoteke se berejo v tem zavihku brskalnika in se nikamor ne naložijo.",
    needFiles: "Za nadaljevanje dodajte vsaj eno datoteko.",
  },
  details: {
    title: "Vaši podatki",
    intro:
      "FURS jih potrebuje v glavi datoteke XML. Ostanejo v pomnilniku tega zavihka in se izbrišejo, ko ga zaprete.",
    taxNumberLabel: "Davčna številka",
    taxNumberHelp: "8 števk",
    taxNumberError: "Vpišite 8 števk davčne številke.",
    nameLabel: "Ime in priimek",
    addressLabel: "Ulica in hišna številka",
    postCodeLabel: "Poštna številka",
    cityLabel: "Kraj",
    emailLabel: "E-pošta (neobvezno)",
    emailHelp: "Le če želite, da vas FURS glede te napovedi lahko kontaktira.",
    residentNote:
      "TaxReporter pripravlja napovedi samo za slovenske davčne rezidente.",
    requiredNote: "Obvezna je le davčna številka.",
    requiredSuffix: "(obvezno)",
    demoNote: "V demu podatki niso obvezni.",
    next: "Na pregled",
    asideTitle: "Kaj se zgodi z vašimi podatki",
    asidePoints: [
      "Gredo v glavo datoteke XML in nikamor drugam.",
      "Nikamor se ne pošljejo: datoteka nastane v tem zavihku.",
      "Ko zaprete zavihek, se izbrišejo. Nič se ne shrani.",
    ],
    previewTitle: "V datoteki XML",
    previewBody:
      "Glava vsake napovedi, sproti med vnosom. Prazna polja so izpuščena.",
    payersTitle: "Kdo vam je izplačal dividende",
    payersIntro:
      "Za Doh-Div so potrebni ime, naslov in država vsakega izplačevalca. TaxReporter jih ne išče na spletu, saj bi s tem strežniku razkril, kaj imate: naslov družbe najdete v njenem letnem poročilu ali na njeni spletni strani.",
    payments: {
      one: "{n} izplačilo letos",
      two: "{n} izplačili letos",
      few: "{n} izplačila letos",
      other: "{n} izplačil letos",
    },
    payerName: "Ime izplačevalca",
    payerAddress: "Naslov izplačevalca",
    payerCountry: "Država izplačevalca",
    payerTaxNumber: "Davčna številka izplačevalca",
    payerTaxNumberHelp:
      "Slovenskega izplačevalca določa njegova 8-mestna davčna številka, ki jo Doh-Div potrebuje.",
    payerId: "Davčna številka izplačevalca (neobvezno)",
    payerIdHelp:
      "Če polje pustite prazno, je namesto nje vpisana koda ISIN, kar eDavki sprejmejo.",
    sourceCountry: "Država, iz katere je dohodek",
    sourceCountryHelp: "Koda ISIN je ne navaja.",
    countryChoose: "Izberite državo",
    payersMissing: {
      one: "Še {n} izplačevalec potrebuje podatke. Do takrat Doh-Div ni zapisan, Doh-KDVP pa je.",
      two: "Še {n} izplačevalca potrebujeta podatke. Do takrat Doh-Div ni zapisan, Doh-KDVP pa je.",
      few: "Še {n} izplačevalci potrebujejo podatke. Do takrat Doh-Div ni zapisan, Doh-KDVP pa je.",
      other:
        "Še {n} izplačevalcev potrebuje podatke. Do takrat Doh-Div ni zapisan, Doh-KDVP pa je.",
    },
  },
  review: {
    title: (year) => `Pregled za davčno leto ${year}`,
    intro:
      "Pred prenosom preverite vsako številko. TaxReporter pripravi napoved, končni davek pa izračunajo eDavki.",
    salesLabel: "Prodani vrednostni papirji",
    gainsTaxLabel: "Ocena davka od dobička",
    dividendsLabel: "Prejete dividende",
    dividendsTaxLabel: "Ocena doplačila davka od dividend",
    estimateNote: "Le ocena. Davek v odločbi izračunajo eDavki.",
    estimateChip: "Ocena",
    bucketsTitle: "Neto davčna osnova po stopnjah",
    byMonthTitle: "Dividende po mesecih",
    monthAmount: (month, amount) => `${month}: ${amount}`,
    creditLabel: "Odbitek tujega davka",
    dividendSplitTitle: (rate) => `Slovenski davek po stopnji ${rate}`,
    stillDue: "Za doplačilo",
    showNotes: "Pokaži opombe",
    tabsLabel: "Obrazca in opombe",
    tabGains: "Dobiček (Doh-KDVP)",
    tabGainsShort: "Dobiček",
    tabDividends: "Dividende (Doh-Div)",
    tabDividendsShort: "Dividende",
    tabNotes: (count) => `Opombe (${count})`,
    tabNotesShort: "Opombe",
    colSold: "Prodano",
    colProceeds: "Vrednost ob odsvojitvi",
    colCost: "Nabavna vrednost",
    colGain: "Dobiček ali izguba",
    showDetails: (symbol) => `${symbol}: popisni list in povezani nakupi`,
    rowsTitle: "Popisni list",
    colDate: "Datum",
    colType: "Vrsta",
    colQuantity: "Količina",
    colPrice: "Cena",
    colRate: "Tečaj",
    colEurPerUnit: "EUR na enoto",
    colSource: "Vir",
    purchase: "Nakup",
    sale: "Prodaja",
    splitNote: (ratio, date) => `Prilagojeno za delitev ${ratio} z dne ${date}`,
    lotsTitle: "Povezani nakupi po metodi FIFO",
    colBought: "Nakup",
    colAcquisition: "Nabavna vrednost",
    colDisposal: "Vrednost ob odsvojitvi",
    colHeld: "Imetništvo",
    colBucket: "Stopnja",
    years: {
      one: "{n} leto",
      two: "{n} leti",
      few: "{n} leta",
      other: "{n} let",
    },
    estimateTitle: "Kako je sestavljena ocena davka od dobička",
    positiveBucket: (rate) =>
      `Dobiček po stopnji ${rate}, po normiranih stroških`,
    losses: "Izgube istega leta",
    netBase: "Neto davčna osnova",
    allocatedBucket: (rate) => `Del, obdavčen po stopnji ${rate}`,
    estimatedTax: "Ocena davka",
    rate: (rate, currency) => `1 EUR = ${rate} ${currency}`,
    rateList: (date) => `tečajnica BS z dne ${date}`,
    rateFixed: "Nepreklicno menjalno razmerje za evro",
    rateMonthly: (month) => `mesečna tečajnica BS za ${month}`,
    rateInEur: "Že v EUR",
    source: (file, row) => `${file}, vrstica ${row}`,
    sourceIn: (file, part, row) => `${file}, ${part}, vrstica ${row}`,
    colPayer: "Izplačevalec",
    colCountry: "Država",
    colGross: "Bruto",
    colForeignTax: "Odtegnjeni davek",
    colCredit: "Odbitek",
    creditCapped: (rate) => `Odbitek omejen na stopnjo iz pogodbe, ${rate}`,
    dividendsTotal: "Skupaj",
    noneBlocking: "Nič ne preprečuje prenosa.",
    severity: {
      blocking: "Odpravite pred prenosom",
      warning: "Preverite",
      info: "V vednost",
    },
    emptyTitle: "Ni še česa pregledati",
    emptyBody:
      "Dodajte izvoze posrednikov, da tu vidite svoje napovedi, ali preizkusite pregled z demo podatki.",
    noSales:
      "V tem davčnem letu niste prodali vrednostnih papirjev, zato napovedi Doh-KDVP ni treba oddati.",
    noDividends: "V tem davčnem letu niste prejeli dividend.",
    attention: {
      one: "{n} opomba zahteva vašo pozornost pred prenosom.",
      two: "{n} opombi zahtevata vašo pozornost pred prenosom.",
      few: "{n} opombe zahtevajo vašo pozornost pred prenosom.",
      other: "{n} opomb zahteva vašo pozornost pred prenosom.",
    },
    moreNotes: {
      one: "Še {n} opomba ni prikazana.",
      two: "Še {n} opombi nista prikazani.",
      few: "Še {n} opombe niso prikazane.",
      other: "Še {n} opomb ni prikazanih.",
    },
    blocked: "Pred nadaljevanjem odpravite opombe, ki ustavijo napovedi.",
    blockedOne: (form) =>
      `${form} ni zapisan, dokler niso odpravljene opombe, ki ga ustavijo. Z drugo napovedjo lahko nadaljujete.`,
    preparing:
      "Napovedi se pripravljajo iz vaših datotek, po tečajih Banke Slovenije.",
    prepareFailed:
      "Napovedi ni bilo mogoče pripraviti. Vrnite se in nadaljujte znova ali znova naložite stran; nič ni bilo nikamor poslano.",
    unnamedFile: "datoteka",
    foreignTaxProof:
      "FURS lahko zahteva dokazilo, da je bil tuji davek dokončno plačan. Shranite letna poročila borznih posrednikov.",
  },
  download: {
    title: "Prenos in uvoz",
    intro: (deadline) =>
      `Vsako datoteko uvozite v eDavke, preverite obrazec in ga oddajte do ${deadline}.`,
    due: (deadline) => `Rok: ${deadline}`,
    preparingChip: "V pripravi",
    readyChip: "Pripravljeno",
    notWrittenChip: "Ni zapisano",
    kdvpTitle: "Doh-KDVP",
    kdvpBody: {
      one: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisni list.",
      two: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisna lista.",
      few: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisni listi.",
      other: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisnih listov.",
    },
    kdvpNone:
      "Dobiček od odsvojitve vrednostnih papirjev: popisnega lista ni bilo mogoče sestaviti.",
    divTitle: "Doh-Div",
    divBody: {
      one: "Dividende: {n} izplačilo.",
      two: "Dividende: {n} izplačili.",
      few: "Dividende: {n} izplačila.",
      other: "Dividende: {n} izplačil.",
    },
    divNone: "Dividende: nobenega izplačila ni bilo mogoče navesti.",
    downloadButton: (form) => `Prenesi ${form}`,
    preparing:
      "Datoteke nastajajo iz poslov in dividend, po tečajih Banke Slovenije.",
    demoFiles:
      "Datoteki vsebujeta izmišljene posle iz demonstracije za izmišljenega zavezanca z davčno številko 12345678. Zapisani sta natanko tako kot vaše, zato vidite, kaj prejmejo eDavki, vendar ju v eDavke ne uvažajte.",
    ownFiles:
      "Pred oddajo v eDavkih vsak obrazec primerjajte s pregledom. TaxReporter napovedi pripravi, oddate jih vi.",
    notWritten: {
      one: "Ni zapisano: najprej je treba odpraviti {n} težavo v pregledu.",
      two: "Ni zapisano: najprej je treba odpraviti {n} težavi v pregledu.",
      few: "Ni zapisano: najprej je treba odpraviti {n} težave v pregledu.",
      other: "Ni zapisano: najprej je treba odpraviti {n} težav v pregledu.",
    },
    failed:
      "Datotek ni bilo mogoče zapisati. Za nov poskus znova naložite stran; nič ni bilo nikamor poslano.",
    importTitle: "Uvoz v eDavke",
    nothingToFile:
      "V tem davčnem letu niste prodali vrednostnih papirjev in niste prejeli dividend, zato ni česa oddati.",
    importSteps: (deadline, forms) => [
      "Prijavite se v eDavke.",
      "Odprite Dokumenti, nato Uvoz, in izberite datoteko.",
      "Odprite uvoženi obrazec in ga primerjajte s tem pregledom.",
      forms > 1
        ? `Oddajte ga do ${deadline} in postopek ponovite za drugo datoteko.`
        : `Oddajte ga do ${deadline}.`,
    ],
    startOver: "Začni znova",
  },
};

export const MESSAGES = { en, sl } as const;
