/**
 * Findings, grouped by severity. The engine emits codes and parameters; the
 * catalog (i18n/findings.ts, through i18n/present.ts) is the one place that
 * turns them into sentences in the UI language.
 */
import { CheckIcon } from "@phosphor-icons/react";

import { formatNumber, plural } from "../../i18n/format";
import { useI18n } from "../../i18n/i18n";
import { findingText } from "../../i18n/present";
import type { DiagnosticSeverity, Finding } from "../../model/preview";
import { SourceText } from "../../ui/bits";
import { Chip, Note } from "../../ui/kit";

const TONE = {
  blocking: "danger",
  warning: "warn",
  info: "neutral",
} as const satisfies Record<DiagnosticSeverity, string>;

const ORDER: readonly DiagnosticSeverity[] = ["blocking", "warning", "info"];

/** Notes shown of one severity; a long list says how many more it holds. */
export const SHOWN_PER_GROUP = 100;

export function NotesPanel({
  findings,
  omitted = 0,
  symbols,
  fileNames,
}: {
  readonly findings: readonly Finding[];
  /** Notes the engine left out of `findings` (engine/toPreview.ts). */
  readonly omitted?: number;
  /** Tickers by ISIN, to name securities. */
  readonly symbols: Readonly<Record<string, string>>;
  /** The names of the files read, by their position in the request. */
  readonly fileNames: readonly string[];
}) {
  const { locale, t } = useI18n();
  const fileName = (file: number) => fileNames[file] ?? t.review.unnamedFile;
  const context = { locale, symbols, fileName };
  const hasBlocking = findings.some((d) => d.severity === "blocking");
  return (
    <div className="panel-stack">
      {hasBlocking ? null : (
        <p>
          <Chip tone="accent" size="md">
            <CheckIcon size={14} weight="bold" aria-hidden />
            {t.review.noneBlocking}
          </Chip>
        </p>
      )}
      {ORDER.map((severity) => {
        const group = findings.filter((d) => d.severity === severity);
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
              {group.slice(0, SHOWN_PER_GROUP).map((d, i) => (
                <Note key={`${d.code}-${String(i)}`} tone={TONE[severity]}>
                  {findingText(d, context)}
                  {d.source === undefined ? null : (
                    <>
                      {" "}
                      <SourceText
                        source={{
                          file: fileName(d.source.file),
                          row: d.source.row,
                        }}
                      />
                    </>
                  )}
                </Note>
              ))}
              {group.length > SHOWN_PER_GROUP ? (
                <p className="muted small">
                  {plural(
                    group.length - SHOWN_PER_GROUP,
                    locale,
                    t.review.moreNotes,
                  )}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {omitted === 0 ? null : (
        <p className="muted small">
          {plural(omitted, locale, t.review.moreNotes)}
        </p>
      )}
    </div>
  );
}
