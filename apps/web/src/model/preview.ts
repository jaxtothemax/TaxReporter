/**
 * The web UI's view of a prepared return. The review screens render only this
 * shape; when the core pipeline lands, an adapter maps its output onto it, so
 * the screens never depend on parser or lot-engine internals.
 *
 * Every amount is a plain decimal string ("1234.56", "-427.50"), never a JS
 * number: the UI formats values, it never does arithmetic on them (ADR 0006).
 */

/** Brokers the review can show, in display order. */
export const BROKERS = ["trading212", "ibkr"] as const;
export type BrokerId = (typeof BROKERS)[number];

/** ISO 8601 calendar date, e.g. "2026-03-12". */
export type IsoDate = string;

/** A plain decimal string, e.g. "1234.56" or "-0.5". */
export type DecimalString = string;

export interface Money {
  readonly amount: DecimalString;
  /** ISO 4217 code, e.g. "USD". */
  readonly currency: string;
}

/** Where a converted amount's exchange rate came from (ADR 0005). */
export interface RateProvenance {
  readonly currency: string;
  /** Units of `currency` per 1 EUR, exactly as Banka Slovenije published it. */
  readonly rate: DecimalString;
  /** The BSI list used: the event date, or the last list before it. */
  readonly listDate: IsoDate;
  readonly source: "bsi-daily" | "bsi-monthly";
}

export interface SourceRef {
  readonly file: string;
  /** 1-based row (CSV) or record (XML) number in that file. */
  readonly row: number;
}

/** One row of a Doh-KDVP inventory list (popisni list). */
export interface KdvpRow {
  readonly kind: "purchase" | "sale";
  /** Trade (contract) date, never the settlement date. */
  readonly date: IsoDate;
  readonly quantity: DecimalString;
  /** Price per unit in the instrument's currency, split-adjusted. */
  readonly price: Money;
  /** null when the price is already in EUR. */
  readonly rate: RateProvenance | null;
  /** Price per unit in EUR at the form's 8-decimal scale. */
  readonly priceEur: DecimalString;
  readonly broker: BrokerId;
  readonly source: SourceRef;
  /** Set when a corporate action changed the quantity and price shown. */
  readonly splitAdjusted?: { readonly ratio: string; readonly date: IsoDate };
}

/**
 * Holding-period tax rate buckets in percent, shortest holding first: 25% under
 * 5 years, then 20%, 15%, and 0% after 15 years (ZDoh-2 Art. 96 and 132; see
 * docs/research/04-si-tax-rules.md).
 */
export const HOLDING_BUCKETS = ["25", "20", "15", "0"] as const;
export type HoldingBucket = (typeof HOLDING_BUCKETS)[number];

/** A sale matched against one purchase lot, FIFO per ISIN across brokers. */
export interface MatchedLot {
  readonly purchaseDate: IsoDate;
  readonly saleDate: IsoDate;
  readonly quantity: DecimalString;
  readonly acquisitionEur: DecimalString;
  readonly disposalEur: DecimalString;
  /** disposalEur minus acquisitionEur. */
  readonly gainEur: DecimalString;
  /** 1% of acquisition plus 1% of disposal, capped at the gain; 0 for a loss. */
  readonly normedCostsEur: DecimalString;
  readonly yearsHeld: number;
  readonly bucket: HoldingBucket;
}

export interface SecurityResult {
  readonly isin: string;
  readonly symbol: string;
  readonly name: string;
  readonly brokers: readonly BrokerId[];
  readonly rows: readonly KdvpRow[];
  readonly lots: readonly MatchedLot[];
  readonly quantitySold: DecimalString;
  readonly proceedsEur: DecimalString;
  readonly costEur: DecimalString;
  readonly gainEur: DecimalString;
}

export interface DividendRow {
  readonly date: IsoDate;
  readonly symbol: string;
  readonly payer: string;
  readonly isin: string;
  /** ISO 3166-1 alpha-2 country of the payer and of the income. */
  readonly country: string;
  readonly gross: Money;
  readonly foreignTax: Money;
  readonly rate: RateProvenance | null;
  readonly grossEur: DecimalString;
  readonly foreignTaxEur: DecimalString;
  /** Foreign tax that can be credited: capped by the treaty rate and by Slovenian tax. */
  readonly creditEur: DecimalString;
  /** Treaty rate cap as a decimal fraction ("0.15"), or null when nothing was withheld. */
  readonly treatyRate: DecimalString | null;
  readonly broker: BrokerId;
  readonly source: SourceRef;
}

export type DiagnosticSeverity = "blocking" | "warning" | "info";

/**
 * A finding for the user. The text lives in the message catalog under
 * `diagnostics.<code>`, so the core can emit codes and parameters and the UI
 * stays the only place that knows the wording, in both languages.
 */
export type Diagnostic =
  | {
      readonly severity: DiagnosticSeverity;
      readonly code: "excessWithholding";
      readonly params: {
        readonly payer: string;
        readonly country: string;
        readonly withheldEur: DecimalString;
        readonly withheldRate: DecimalString;
        readonly treatyRate: DecimalString;
        readonly creditEur: DecimalString;
        readonly excessEur: DecimalString;
      };
    }
  | {
      readonly severity: DiagnosticSeverity;
      readonly code: "splitAdjusted";
      readonly params: {
        readonly symbol: string;
        readonly ratio: string;
        readonly date: IsoDate;
      };
    }
  | {
      readonly severity: DiagnosticSeverity;
      readonly code: "lossCounts";
      readonly params: { readonly symbol: string; readonly saleDate: IsoDate };
    }
  | {
      readonly severity: DiagnosticSeverity;
      readonly code: "holidayRate";
      readonly params: {
        readonly payer: string;
        readonly date: IsoDate;
        readonly listDate: IsoDate;
      };
    }
  | {
      readonly severity: DiagnosticSeverity;
      readonly code: "rowsSetAside";
      readonly params: {
        readonly file: string;
        readonly deposits: number;
        readonly interest: number;
        readonly conversions: number;
      };
    }
  | {
      readonly severity: DiagnosticSeverity;
      readonly code: "foreignTaxProof";
      readonly params: Readonly<Record<string, never>>;
    };

export interface ImportedFile {
  readonly name: string;
  readonly broker: BrokerId;
  readonly firstDate: IsoDate;
  readonly lastDate: IsoDate;
  readonly rowsRead: number;
}

/** The estimate shown next to the inventory lists; eDavki computes the real tax. */
export interface GainsEstimate {
  /** Positive bases after normed costs, per bucket. */
  readonly positiveByBucket: Readonly<Record<HoldingBucket, DecimalString>>;
  /** Sum of the losses (negative), offset against gains of the same year. */
  readonly lossesEur: DecimalString;
  readonly netBaseEur: DecimalString;
  /** The net base split pro rata across buckets. */
  readonly allocatedByBucket: Readonly<Record<HoldingBucket, DecimalString>>;
  readonly taxEur: DecimalString;
}

export interface DividendsEstimate {
  /**
   * The Slovenian tax on dividends as a fraction, "0.25": a final tax under
   * ZDoh-2 Art. 132(1) (docs/research/04-si-tax-rules.md §2.2).
   */
  readonly taxRate: DecimalString;
  readonly grossEur: DecimalString;
  readonly foreignTaxEur: DecimalString;
  readonly creditEur: DecimalString;
  /** 25% Slovenian tax minus the creditable foreign tax, summed per payment. */
  readonly taxDueEur: DecimalString;
}

/** Totals over every matched lot, for the headline figures. */
export interface GainsTotals {
  readonly proceedsEur: DecimalString;
  readonly costEur: DecimalString;
  /** proceedsEur minus costEur, before normed costs. */
  readonly gainEur: DecimalString;
}

/** Gross dividends per calendar month of the tax year ("2026-03"). */
export interface MonthlyAmount {
  readonly month: string;
  readonly grossEur: DecimalString;
}

export interface ReturnPreview {
  readonly taxYear: number;
  readonly files: readonly ImportedFile[];
  readonly securities: readonly SecurityResult[];
  readonly dividends: readonly DividendRow[];
  readonly diagnostics: readonly Diagnostic[];
  readonly gainsTotals: GainsTotals;
  readonly gainsEstimate: GainsEstimate;
  readonly dividendsEstimate: DividendsEstimate;
  /** All twelve months, zero where nothing was paid. */
  readonly dividendsByMonth: readonly MonthlyAmount[];
}
