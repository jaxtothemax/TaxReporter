/**
 * Download and import. The returns are written when this step opens, by the
 * same engine and writers as the command line's (ADR 0011), and saved on the
 * user's device. A button that cannot save yet stays visible, disabled, with
 * the reason next to it. A form with nothing in it gets no card: there is
 * nothing to file.
 */
import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  DownloadSimpleIcon,
  FileCodeIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import type { BuiltForm, BuiltReturns } from "../engine/demoReturns";
import { saveFile } from "../engine/saveFile";
import { formatDate, formatNumber, plural } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { ReturnPreview } from "../model/preview";
import { Button, Chip, Note } from "../ui/kit";

/** Where writing the returns stands. */
type Writing =
  | { readonly status: "preparing" }
  | { readonly status: "ready"; readonly returns: BuiltReturns }
  | { readonly status: "failed" };

/** The note every disabled button points at while nothing can be saved. */
const STATUS_NOTE = "download-status";

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

export function FormCard({
  id,
  form,
  body,
  fileName,
  built,
}: {
  readonly id: string;
  readonly form: string;
  readonly body: string;
  readonly fileName: string;
  /** The written return, or null while it is being written or failed. */
  readonly built: BuiltForm | null;
}) {
  const { locale, t } = useI18n();
  const xml = built?.xml ?? null;
  const reasonId = `${id}-not-written`;
  const chip =
    built === null ? (
      <Chip tone="neutral">{t.download.preparingChip}</Chip>
    ) : xml === null ? (
      <Chip tone="warn">{t.download.notWrittenChip}</Chip>
    ) : (
      <Chip tone="accent">{t.download.readyChip}</Chip>
    );
  return (
    <div className="card form-file-card">
      <div className="form-file-top">
        <span className="icon-tile" aria-hidden>
          <FileCodeIcon size={22} weight="bold" />
        </span>
        {chip}
      </div>
      <h2 className="form-file-title">{form}</h2>
      <p className="muted">{body}</p>
      <p>
        <code className="code-badge">{built?.fileName ?? fileName}</code>
      </p>
      {built !== null && xml === null ? (
        <p className="muted" id={reasonId}>
          {plural(built.blocking, locale, t.download.notWritten)}
        </p>
      ) : null}
      {built === null || xml === null ? (
        <Button
          variant="primary"
          aria-disabled
          aria-describedby={built === null ? STATUS_NOTE : reasonId}
        >
          <DownloadSimpleIcon size={18} weight="bold" aria-hidden />
          {t.download.downloadButton(form)}
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => {
            saveFile(built.fileName, xml);
          }}
        >
          <DownloadSimpleIcon size={18} weight="bold" aria-hidden />
          {t.download.downloadButton(form)}
        </Button>
      )}
    </div>
  );
}

export function DownloadStep({
  preview,
  writeReturns,
  onBack,
  onRestart,
}: {
  readonly preview: ReturnPreview;
  /** Writes the returns the preview shows; awaited when the step opens. */
  readonly writeReturns: () => Promise<BuiltReturns>;
  readonly onBack: () => void;
  readonly onRestart: () => void;
}) {
  const { locale, t } = useI18n();
  const [writing, setWriting] = useState<Writing>({ status: "preparing" });
  useEffect(() => {
    let current = true;
    writeReturns().then(
      (returns) => {
        if (current) setWriting({ status: "ready", returns });
      },
      () => {
        if (current) setWriting({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [writeReturns]);
  const returns = writing.status === "ready" ? writing.returns : null;
  const deadline = formatDate(filingDeadline(preview.taxYear), locale);
  const year = String(preview.taxYear);
  const forms = [
    preview.securities.length === 0 ? null : (
      <FormCard
        key="kdvp"
        id="kdvp"
        form={t.download.kdvpTitle}
        body={plural(preview.securities.length, locale, t.download.kdvpBody)}
        fileName={`Doh_KDVP_${year}.xml`}
        built={returns?.kdvp ?? null}
      />
    ),
    preview.dividends.length === 0 ? null : (
      <FormCard
        key="div"
        id="div"
        form={t.download.divTitle}
        body={plural(preview.dividends.length, locale, t.download.divBody)}
        fileName={`Doh_Div_${year}.xml`}
        built={returns?.div ?? null}
      />
    ),
  ].filter((card) => card !== null);
  return (
    <div className="screen">
      <header className="screen-head">
        <h1 tabIndex={-1}>{t.download.title}</h1>
        {forms.length === 0 ? null : (
          <>
            <p className="lead">{t.download.intro(deadline)}</p>
            <p>
              <Chip tone="accent" size="md">
                <CalendarBlankIcon size={16} weight="bold" aria-hidden />
                {t.download.due(deadline)}
              </Chip>
            </p>
          </>
        )}
      </header>

      {forms.length === 0 ? (
        <Note tone="neutral">{t.download.nothingToFile}</Note>
      ) : (
        <>
          <div className="form-cards">{forms}</div>

          {writing.status === "preparing" ? (
            <Note tone="neutral" id={STATUS_NOTE}>
              {t.download.preparing}
            </Note>
          ) : writing.status === "failed" ? (
            <Note tone="danger" id={STATUS_NOTE}>
              {t.download.failed}
            </Note>
          ) : (
            <Note tone="warn">{t.download.demoFiles}</Note>
          )}

          <div className="card import-card">
            <h2>{t.download.importTitle}</h2>
            <ol className="timeline" role="list">
              {t.download.importSteps(deadline, forms.length).map((step, i) => (
                <li key={step}>
                  <span className="timeline-dot num" aria-hidden>
                    {formatNumber(String(i + 1), locale)}
                  </span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

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
