/**
 * Diagnostics, grouped by severity. The core emits codes and raw parameters;
 * this is the one place that turns them into sentences in the UI language.
 */
import { CheckCircleIcon } from "@phosphor-icons/react";
import { Flex, Heading, Text } from "@radix-ui/themes";

import {
  formatCountry,
  formatDate,
  formatEur,
  formatNumber,
  formatPercent,
  type Locale,
} from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import type { Messages } from "../../i18n/messages";
import type { Diagnostic, DiagnosticSeverity } from "../../model/preview";
import { Note } from "../../ui/bits";

export function diagnosticText(
  d: Diagnostic,
  locale: Locale,
  t: Messages,
): string {
  const m = t.diagnostics;
  switch (d.code) {
    case "excessWithholding":
      return m.excessWithholding({
        payer: d.params.payer,
        country: formatCountry(d.params.country, locale),
        withheldRate: formatPercent(d.params.withheldRate, locale),
        treatyRate: formatPercent(d.params.treatyRate, locale),
        creditEur: formatEur(d.params.creditEur, locale),
        excessEur: formatEur(d.params.excessEur, locale),
      });
    case "splitAdjusted":
      return m.splitAdjusted({
        ...d.params,
        date: formatDate(d.params.date, locale),
      });
    case "lossCounts":
      return m.lossCounts({
        ...d.params,
        saleDate: formatDate(d.params.saleDate, locale),
      });
    case "holidayRate":
      return m.holidayRate({
        payer: d.params.payer,
        date: formatDate(d.params.date, locale),
        listDate: formatDate(d.params.listDate, locale),
      });
    case "rowsSetAside":
      return m.rowsSetAside({
        file: d.params.file,
        deposits: formatNumber(String(d.params.deposits), locale),
        interest: formatNumber(String(d.params.interest), locale),
        conversions: formatNumber(String(d.params.conversions), locale),
      });
    case "foreignTaxProof":
      return m.foreignTaxProof();
  }
}

const TONE = {
  blocking: "red",
  warning: "amber",
  info: "gray",
} as const satisfies Record<DiagnosticSeverity, string>;

const ORDER: readonly DiagnosticSeverity[] = ["blocking", "warning", "info"];

export function NotesPanel({
  diagnostics,
}: {
  readonly diagnostics: readonly Diagnostic[];
}) {
  const { locale, t } = useI18n();
  const hasBlocking = diagnostics.some((d) => d.severity === "blocking");
  return (
    <Flex direction="column" gap="6">
      {hasBlocking ? null : (
        <Flex align="center" gap="2">
          <CheckCircleIcon
            size={20}
            weight="fill"
            aria-hidden
            className="accent-icon"
          />
          <Text weight="medium">{t.review.noneBlocking}</Text>
        </Flex>
      )}
      {ORDER.map((severity) => {
        const group = diagnostics.filter((d) => d.severity === severity);
        if (group.length === 0) return null;
        return (
          <section key={severity} aria-labelledby={`notes-${severity}`}>
            <Heading as="h3" size="3" mb="3" id={`notes-${severity}`}>
              {t.review.severity[severity]}
            </Heading>
            <Flex direction="column" gap="3">
              {group.map((d, i) => (
                <Note key={`${d.code}-${String(i)}`} tone={TONE[severity]}>
                  {diagnosticText(d, locale, t)}
                </Note>
              ))}
            </Flex>
          </section>
        );
      })}
    </Flex>
  );
}
