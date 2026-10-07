/** Small presentational pieces shared by the start screen, the flow and the review. */
import { ArrowsLeftRightIcon } from "@phosphor-icons/react";

import {
  formatDate,
  formatEur,
  formatPercent,
  formatRate,
  isNegative,
  type Locale,
} from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type {
  BrokerId,
  HoldingBucket,
  RateProvenance,
  SourceRef,
} from "../model/preview";
import { cx, Note } from "./kit";

/** A holding-period bucket as a rate: "25" is "25 %" in Slovenian, "25%" in English. */
export function bucketLabel(bucket: HoldingBucket, locale: Locale): string {
  return formatPercent(`0.${bucket.padStart(2, "0")}`, locale);
}

/** A euro amount; losses are red and carry a real minus sign, not color alone. */
export function Eur({
  value,
  signed = false,
  strong = false,
}: {
  readonly value: string;
  readonly signed?: boolean;
  readonly strong?: boolean;
}) {
  const { locale } = useI18n();
  return (
    <span
      className={cx(
        "num",
        "nowrap",
        strong && "is-strong",
        isNegative(value) && "is-loss",
      )}
    >
      {formatEur(value, locale, { signed })}
    </span>
  );
}

/** "1 EUR = 1,1547 USD" with the BSI list it came from, or "Already in EUR". */
export function RateText({ rate }: { readonly rate: RateProvenance | null }) {
  const { locale, t } = useI18n();
  if (rate === null) {
    return <span className="muted small">{t.review.rateInEur}</span>;
  }
  return (
    <span className="stack-tight">
      <span className="num nowrap">
        {t.review.rate(formatRate(rate.rate, locale), rate.currency)}
      </span>
      <span className="muted small">
        {t.review.rateList(formatDate(rate.listDate, locale))}
      </span>
    </span>
  );
}

/** The rate as a chip, for the places that show one conversion on its own. */
export function RateChip({ rate }: { readonly rate: RateProvenance }) {
  const { locale, t } = useI18n();
  return (
    <span className="rate-chip">
      <ArrowsLeftRightIcon size={14} weight="bold" aria-hidden />
      <span className="num">
        {t.review.rate(formatRate(rate.rate, locale), rate.currency)}
      </span>
      <span className="rate-chip-list">
        {t.review.rateList(formatDate(rate.listDate, locale))}
      </span>
    </span>
  );
}

/** File and row; a row number is an identifier, so its digits are never grouped. */
export function SourceText({ source }: { readonly source: SourceRef }) {
  const { t } = useI18n();
  return (
    <span className="mono muted small">
      {t.review.source(source.file, String(source.row))}
    </span>
  );
}

export function BrokerName({ broker }: { readonly broker: BrokerId }) {
  const { t } = useI18n();
  return <>{t.brokers[broker]}</>;
}

/** Shown on every flow screen while the data on it is made up. */
export function DemoBanner() {
  const { t } = useI18n();
  return (
    <Note tone="warn">
      <strong>{t.demoBanner.title}</strong> {t.demoBanner.body}
    </Note>
  );
}
