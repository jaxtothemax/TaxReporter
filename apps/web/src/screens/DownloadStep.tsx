/**
 * Download and import. The XML writer does not exist yet, so the download
 * buttons are disabled with the reason shown next to them, never hidden. A
 * form with nothing in it gets no card: there is nothing to file.
 */
import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  DownloadSimpleIcon,
  FileCodeIcon,
} from "@phosphor-icons/react";

import { formatDate, formatNumber, plural } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { ReturnPreview } from "../model/preview";
import { Button, Chip, Note } from "../ui/kit";

/**
 * 28 February, moved to the next working day when it is not one (ZDavP-2
 * Art. 45(2)); for tax year 2026 that is Monday 1 March 2027
 * (docs/research/04-si-tax-rules.md).
 */
export function filingDeadline(taxYear: number): string {
  const due = new Date(Date.UTC(taxYear + 1, 1, 28));
  const day = due.getUTCDay();
  if (day === 6) due.setUTCDate(due.getUTCDate() + 2);
  if (day === 0) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString().slice(0, 10);
}

function FormCard({
  form,
  body,
  fileName,
}: {
  readonly form: string;
  readonly body: string;
  readonly fileName: string;
}) {
  const { t } = useI18n();
  return (
    <div className="card form-file-card">
      <div className="form-file-top">
        <span className="icon-tile" aria-hidden>
          <FileCodeIcon size={22} weight="bold" />
        </span>
        <Chip tone="warn">{t.download.notBuiltChip}</Chip>
      </div>
      <h2 className="form-file-title">{form}</h2>
      <p className="muted">{body}</p>
      <p className="file-chip mono">{fileName}</p>
      <Button variant="primary" disabled aria-describedby="download-not-built">
        <DownloadSimpleIcon size={18} weight="bold" aria-hidden />
        {t.download.downloadButton(form)}
      </Button>
    </div>
  );
}

export function DownloadStep({
  preview,
  onBack,
  onRestart,
}: {
  readonly preview: ReturnPreview;
  readonly onBack: () => void;
  readonly onRestart: () => void;
}) {
  const { locale, t } = useI18n();
  const deadline = formatDate(filingDeadline(preview.taxYear), locale);
  const year = String(preview.taxYear);
  return (
    <div className="screen">
      <header className="screen-head">
        <h1 tabIndex={-1}>{t.download.title}</h1>
        <p className="lead">{t.download.intro(deadline)}</p>
        <p className="due-chip">
          <CalendarBlankIcon size={16} weight="bold" aria-hidden />
          {t.download.due(deadline)}
        </p>
      </header>

      <div className="form-cards">
        {preview.securities.length === 0 ? null : (
          <FormCard
            form={t.download.kdvpTitle}
            body={plural(
              preview.securities.length,
              locale,
              t.download.kdvpBody,
            )}
            fileName={`Doh-KDVP-${year}.xml`}
          />
        )}
        {preview.dividends.length === 0 ? null : (
          <FormCard
            form={t.download.divTitle}
            body={plural(preview.dividends.length, locale, t.download.divBody)}
            fileName={`Doh-Div-${year}.xml`}
          />
        )}
      </div>

      <Note tone="neutral" id="download-not-built">
        {t.download.notBuilt}
      </Note>

      <div className="card import-card">
        <h2>{t.download.importTitle}</h2>
        <ol className="timeline" role="list">
          {t.download.importSteps(deadline).map((step, i) => (
            <li key={step}>
              <span className="timeline-dot num" aria-hidden>
                {formatNumber(String(i + 1), locale)}
              </span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="actions-row">
        <Button size="lg" onClick={onBack}>
          {t.nav.back}
        </Button>
        <Button variant="ghost" size="lg" onClick={onRestart}>
          <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden />
          {t.download.startOver}
        </Button>
      </div>
    </div>
  );
}
