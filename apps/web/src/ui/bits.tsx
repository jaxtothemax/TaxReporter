/** Small presentational pieces shared by the start screen, the flow and the review. */
import {
  InfoIcon,
  WarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Callout, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

import { formatDate, formatEur, formatRate, isNegative } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { BrokerId, RateProvenance, SourceRef } from "../model/preview";

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
    <Text
      className="num"
      weight={strong ? "medium" : "regular"}
      color={isNegative(value) ? "red" : undefined}
    >
      {formatEur(value, locale, { signed })}
    </Text>
  );
}

/** "1 EUR = 1,1547 USD" with the BSI list it came from, or "Already in EUR". */
export function RateText({ rate }: { readonly rate: RateProvenance | null }) {
  const { locale, t } = useI18n();
  if (rate === null) {
    return (
      <Text size="1" color="gray">
        {t.review.rateInEur}
      </Text>
    );
  }
  return (
    <span className="stack-tight">
      <Text size="2" className="num">
        {t.review.rate(formatRate(rate.rate, locale), rate.currency)}
      </Text>
      <Text size="1" color="gray">
        {t.review.rateList(formatDate(rate.listDate, locale))}
      </Text>
    </span>
  );
}

/** File and row; a row number is an identifier, so its digits are never grouped. */
export function SourceText({ source }: { readonly source: SourceRef }) {
  const { t } = useI18n();
  return (
    <Text size="1" color="gray" className="mono">
      {t.review.source(source.file, String(source.row))}
    </Text>
  );
}

export function BrokerName({ broker }: { readonly broker: BrokerId }) {
  const { t } = useI18n();
  return <>{t.brokers[broker]}</>;
}

const NOTE_TONES = {
  gray: { Icon: InfoIcon, strong: false },
  amber: { Icon: WarningIcon, strong: true },
  red: { Icon: WarningOctagonIcon, strong: true },
} as const;

/**
 * The one callout recipe: an icon, role="note", and step-12 text on amber and
 * red, where Radix's default step-11 text measured below WCAG AA.
 */
export function Note({
  tone,
  id,
  children,
}: {
  readonly tone: keyof typeof NOTE_TONES;
  readonly id?: string;
  readonly children: ReactNode;
}) {
  const { Icon, strong } = NOTE_TONES[tone];
  return (
    <Callout.Root
      color={tone}
      variant="surface"
      role="note"
      id={id}
      className={strong ? "callout-strong" : undefined}
    >
      <Callout.Icon>
        <Icon size={18} weight="bold" aria-hidden />
      </Callout.Icon>
      <Callout.Text>{children}</Callout.Text>
    </Callout.Root>
  );
}

/** Shown on every flow screen while the data on it is made up. */
export function DemoBanner() {
  const { t } = useI18n();
  return (
    <Note tone="amber">
      <Text weight="bold">{t.demoBanner.title}</Text> {t.demoBanner.body}
    </Note>
  );
}
