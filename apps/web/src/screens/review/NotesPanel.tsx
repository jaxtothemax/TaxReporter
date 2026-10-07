/**
 * Diagnostics, grouped by severity. The core emits codes and raw parameters;
 * this is the one place that turns them into sentences in the UI language.
 */
import { CheckCircleIcon } from "@phosphor-icons/react";

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
import { Note } from "../../ui/kit";

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
  blocking: "danger",
  warning: "warn",
  info: "neutral",
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
    <div className="panel-stack">
      {hasBlocking ? null : (
        <p className="all-clear">
          <CheckCircleIcon size={18} weight="fill" aria-hidden />
          {t.review.noneBlocking}
        </p>
      )}
      {ORDER.map((severity) => {
        const group = diagnostics.filter((d) => d.severity === severity);
        if (group.length === 0) return null;
        return (
          <div key={severity} className="note-group">
            <h3>
              {t.review.severity[severity]}
              <span className="count" aria-hidden>
                {formatNumber(String(group.length), locale)}
              </span>
            </h3>
            <div className="note-stack">
              {group.map((d, i) => (
                <Note key={`${d.code}-${String(i)}`} tone={TONE[severity]}>
                  {diagnosticText(d, locale, t)}
                </Note>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
