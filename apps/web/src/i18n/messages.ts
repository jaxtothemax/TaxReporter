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
    readonly opensInNewTab: string;
  };
  readonly brokers: { readonly trading212: string; readonly ibkr: string };
  readonly start: {
    readonly eyebrow: string;
    readonly title: string;
    readonly subtitle: string;
    readonly primaryCta: string;
    readonly secondaryCta: string;
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
    readonly brokersNow: string;
    readonly brokersNext: string;
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
    readonly notReadYet: string;
    readonly ownFileDetail: (size: string) => string;
    readonly unsupported: string;
    readonly unsupportedBlocked: string;
    readonly announceAdded: PluralForms;
    readonly announceRemoved: (name: string) => string;
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
    readonly demoNote: string;
    readonly next: string;
  };
  readonly review: {
    readonly title: (year: string) => string;
    readonly intro: string;
    readonly salesLabel: string;
    readonly gainsTaxLabel: string;
    readonly dividendsLabel: string;
    readonly dividendsTaxLabel: string;
    readonly estimateNote: string;
    readonly tabGains: string;
    readonly tabDividends: string;
    readonly tabNotes: (count: string) => string;
    readonly colSecurity: string;
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
    readonly rateInEur: string;
    readonly source: (file: string, row: string) => string;
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
    readonly blocked: string;
  };
  readonly diagnostics: {
    readonly excessWithholding: (p: {
      readonly payer: string;
      readonly country: string;
      readonly withheldRate: string;
      readonly treatyRate: string;
      readonly creditEur: string;
      readonly excessEur: string;
    }) => string;
    readonly splitAdjusted: (p: {
      readonly symbol: string;
      readonly ratio: string;
      readonly date: string;
    }) => string;
    readonly lossCounts: (p: {
      readonly symbol: string;
      readonly saleDate: string;
    }) => string;
    readonly holidayRate: (p: {
      readonly payer: string;
      readonly date: string;
      readonly listDate: string;
    }) => string;
    readonly rowsSetAside: (p: {
      readonly file: string;
      readonly deposits: string;
      readonly interest: string;
      readonly conversions: string;
    }) => string;
    readonly foreignTaxProof: () => string;
  };
  readonly download: {
    readonly title: string;
    readonly intro: (deadline: string) => string;
    readonly kdvpTitle: string;
    readonly kdvpBody: PluralForms;
    readonly divTitle: string;
    readonly divBody: PluralForms;
    readonly downloadButton: (form: string) => string;
    readonly notBuilt: string;
    readonly importTitle: string;
    readonly importSteps: (deadline: string) => readonly string[];
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
    opensInNewTab: "(opens in a new tab)",
  },
  brokers: { trading212: "Trading 212", ibkr: "Interactive Brokers" },
  start: {
    eyebrow: "Preview with demo data",
    title: "Doh-KDVP and Doh-Div from your broker's exports",
    subtitle:
      "Converted at Banka Slovenije rates, matched first in, first out across brokers, and prepared on your own computer.",
    primaryCta: "Explore the demo",
    secondaryCta: "Use my files",
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
    brokersNow: "Being built for v0.1: Trading 212 and Interactive Brokers.",
    brokersNext: "Planned next: eToro, Robinhood, Revolut, DEGIRO and others.",
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
    body: "These trades and dividends are made up, but the exchange rates are real Banka Slovenije rates. Reading your own files is not built yet.",
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
    notReadYet: "Not read yet",
    ownFileDetail: (size) => `${size}, not read yet`,
    unsupported: "Not a CSV or XML export. Remove it to continue.",
    unsupportedBlocked: "Remove the files TaxReporter cannot read to continue.",
    announceAdded: { one: "{n} file added.", other: "{n} files added." },
    announceRemoved: (name) => `${name} removed.`,
    rows: { one: "{n} row", other: "{n} rows" },
    coverage: (broker, from, to, rows) =>
      `${broker}, ${from} to ${to}, ${rows}`,
    ownFilesNotice:
      "Reading broker files is not built yet, so your files stay unread. Use the demo files to try the rest of the flow.",
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
    demoNote: "Not required in the demo.",
    next: "Review results",
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
    tabGains: "Gains (Doh-KDVP)",
    tabDividends: "Dividends (Doh-Div)",
    tabNotes: (count) => `Notes (${count})`,
    colSecurity: "Security",
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
    rateInEur: "Already in EUR",
    source: (file, row) => `${file}, row ${row}`,
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
      "Reading broker files is not built yet. Explore the review with the demo data instead.",
    noSales:
      "No securities were sold in this tax year, so there is no Doh-KDVP to file.",
    noDividends: "No dividends were paid in this tax year.",
    attention: {
      one: "{n} note needs your attention before you download.",
      other: "{n} notes need your attention before you download.",
    },
    blocked: "Fix the notes that block the download before you continue.",
  },
  diagnostics: {
    excessWithholding: (p) =>
      `${p.payer}: ${p.withheldRate} was withheld in ${p.country}, but the tax treaty allows a credit of at most ${p.treatyRate}. Only ${p.creditEur} counts against Slovenian tax. You can reclaim the extra ${p.excessEur} from that country's tax authority.`,
    splitAdjusted: (p) =>
      `${p.symbol}: quantities and prices before ${p.date} are adjusted for the ${p.ratio} split. Purchase dates stay the same.`,
    lossCounts: (p) =>
      `${p.symbol}: the loss from the sale on ${p.saleDate} reduces your gains, because you bought no ${p.symbol} in the 30 days before or after it.`,
    holidayRate: (p) =>
      `${p.payer}, ${p.date}: Banka Slovenije published no exchange rate list that day, so the list of ${p.listDate} was used.`,
    rowsSetAside: (p) =>
      `${p.file}: rows that are neither trades nor dividends were set aside (deposits: ${p.deposits}, interest: ${p.interest}, currency conversions: ${p.conversions}). Interest belongs on Doh-Obr, which TaxReporter will support later.`,
    foreignTaxProof: () =>
      "FURS can ask for proof that foreign tax was finally paid. Keep your brokers' annual statements.",
  },
  download: {
    title: "Download and import",
    intro: (deadline) =>
      `Import each file into eDavki, check the form, and submit it by ${deadline}.`,
    kdvpTitle: "Doh-KDVP",
    kdvpBody: {
      one: "Gains from selling securities: {n} inventory list.",
      other: "Gains from selling securities: {n} inventory lists.",
    },
    divTitle: "Doh-Div",
    divBody: {
      one: "Dividends: {n} payment.",
      other: "Dividends: {n} payments.",
    },
    downloadButton: (form) => `Download ${form}`,
    notBuilt:
      "The XML writer is not built yet, so this preview has nothing to download.",
    importTitle: "Importing into eDavki",
    importSteps: (deadline) => [
      "Log in to eDavki.",
      "Open Dokumenti, then Uvoz, and choose the file.",
      "Open the imported form and compare it with this review.",
      `Submit it by ${deadline}, then repeat for the second file.`,
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
    opensInNewTab: "(odpre se v novem zavihku)",
  },
  brokers: { trading212: "Trading 212", ibkr: "Interactive Brokers" },
  start: {
    eyebrow: "Predogled z demo podatki",
    title: "Doh-KDVP in Doh-Div iz izvozov vašega borznega posrednika",
    subtitle:
      "Preračunano po tečaju Banke Slovenije, po metodi FIFO prek vseh posrednikov in pripravljeno na vašem računalniku.",
    primaryCta: "Preizkusi demo",
    secondaryCta: "Uporabi svoje datoteke",
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
      "Prebrane so v tem zavihku brskalnika in se nikamor ne naložijo. Ni računa in ni sledenja. Ko zaprete zavihek, se vse izbriše.",
    privacyLlm:
      "Načrtujemo izbirno preverjanje z umetno inteligenco. Delovalo bo le z vašim ključem API in šele, ko boste videli, kaj točno pošlje.",
    brokersTitle: "Borzni posredniki",
    brokersNow: "V izdelavi za v0.1: Trading 212 in Interactive Brokers.",
    brokersNext: "Nato: eToro, Robinhood, Revolut, DEGIRO in drugi.",
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
    body: "Posli in dividende so izmišljeni, tečaji pa so pravi tečaji Banke Slovenije. Branje vaših datotek še ni izdelano.",
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
    notReadYet: "Še ni prebrana",
    ownFileDetail: (size) => `${size}, še ni prebrana`,
    unsupported: "To ni izvoz CSV ali XML. Za nadaljevanje ga odstranite.",
    unsupportedBlocked:
      "Za nadaljevanje odstranite datoteke, ki jih TaxReporter ne more prebrati.",
    announceAdded: {
      one: "Dodana je {n} datoteka.",
      two: "Dodani sta {n} datoteki.",
      few: "Dodane so {n} datoteke.",
      other: "Dodanih je {n} datotek.",
    },
    announceRemoved: (name) => `Datoteka ${name} je odstranjena.`,
    rows: {
      one: "{n} vrstica",
      two: "{n} vrstici",
      few: "{n} vrstice",
      other: "{n} vrstic",
    },
    coverage: (broker, from, to, rows) =>
      `${broker}, od ${from} do ${to}, ${rows}`,
    ownFilesNotice:
      "Branje datotek še ni izdelano, zato vaše datoteke ostanejo neprebrane. Preostanek postopka lahko preizkusite z demo datotekami.",
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
    demoNote: "V demu podatki niso obvezni.",
    next: "Na pregled",
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
    tabGains: "Dobiček (Doh-KDVP)",
    tabDividends: "Dividende (Doh-Div)",
    tabNotes: (count) => `Opombe (${count})`,
    colSecurity: "Vrednostni papir",
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
    rateInEur: "Že v EUR",
    source: (file, row) => `${file}, vrstica ${row}`,
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
      "Branje datotek še ni izdelano. Pregled lahko preizkusite z demo podatki.",
    noSales:
      "V tem davčnem letu niste prodali vrednostnih papirjev, zato napovedi Doh-KDVP ni treba oddati.",
    noDividends: "V tem davčnem letu niste prejeli dividend.",
    attention: {
      one: "{n} opomba zahteva vašo pozornost pred prenosom.",
      two: "{n} opombi zahtevata vašo pozornost pred prenosom.",
      few: "{n} opombe zahtevajo vašo pozornost pred prenosom.",
      other: "{n} opomb zahteva vašo pozornost pred prenosom.",
    },
    blocked: "Pred nadaljevanjem odpravite opombe, ki preprečujejo prenos.",
  },
  diagnostics: {
    excessWithholding: (p) =>
      `${p.payer}: država ${p.country} je odtegnila ${p.withheldRate}, pogodba o izogibanju dvojnega obdavčevanja pa dovoljuje odbitek največ ${p.treatyRate}. Pri slovenskem davku se upošteva le ${p.creditEur}. Presežek ${p.excessEur} lahko zahtevate nazaj od davčnega organa te države.`,
    splitAdjusted: (p) =>
      `${p.symbol}: količine in cene pred ${p.date} so prilagojene za delitev delnic ${p.ratio}. Datumi nakupa ostanejo enaki.`,
    lossCounts: (p) =>
      `${p.symbol}: izguba pri prodaji ${p.saleDate} zmanjša dobiček, ker v 30 dneh pred prodajo ali po njej niste kupili ${p.symbol}.`,
    holidayRate: (p) =>
      `${p.payer}, ${p.date}: Banka Slovenije ta dan ni objavila tečajnice, zato je uporabljena tečajnica z dne ${p.listDate}.`,
    rowsSetAside: (p) =>
      `${p.file}: vrstice, ki niso posli ali dividende, so izločene (pologi: ${p.deposits}, obresti: ${p.interest}, menjave valut: ${p.conversions}). Obresti sodijo v napoved Doh-Obr, ki jo bo TaxReporter podpiral pozneje.`,
    foreignTaxProof: () =>
      "FURS lahko zahteva dokazilo, da je bil tuji davek dokončno plačan. Shranite letna poročila borznih posrednikov.",
  },
  download: {
    title: "Prenos in uvoz",
    intro: (deadline) =>
      `Vsako datoteko uvozite v eDavke, preverite obrazec in ga oddajte do ${deadline}.`,
    kdvpTitle: "Doh-KDVP",
    kdvpBody: {
      one: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisni list.",
      two: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisna lista.",
      few: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisni listi.",
      other: "Dobiček od odsvojitve vrednostnih papirjev: {n} popisnih listov.",
    },
    divTitle: "Doh-Div",
    divBody: {
      one: "Dividende: {n} izplačilo.",
      two: "Dividende: {n} izplačili.",
      few: "Dividende: {n} izplačila.",
      other: "Dividende: {n} izplačil.",
    },
    downloadButton: (form) => `Prenesi ${form}`,
    notBuilt:
      "Pisanje datotek XML še ni izdelano, zato v tem predogledu ni česa prenesti.",
    importTitle: "Uvoz v eDavke",
    importSteps: (deadline) => [
      "Prijavite se v eDavke.",
      "Odprite Dokumenti, nato Uvoz, in izberite datoteko.",
      "Odprite uvoženi obrazec in ga primerjajte s tem pregledom.",
      `Oddajte ga do ${deadline} in postopek ponovite za drugo datoteko.`,
    ],
    startOver: "Začni znova",
  },
};

export const MESSAGES = { en, sl } as const;
