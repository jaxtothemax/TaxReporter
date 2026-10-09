/**
 * Download and import. The returns are written by the same engine and
 * writers as the command line's (ADR 0011, ADR 0013): the demo's when this
 * step opens, the user's own already with the review. They are saved on the
 * user's device. A button that cannot save yet stays visible, disabled, with
 * the reason next to it. A form the year does not need gets no card: there
 * is nothing to file. One it needs gets a card even when a finding withholds
 * it before it has a row to show, so that no return goes missing where the
 * files are saved (ADR 0013 §9).
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
import { explain } from "../explain/anchors";
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

/** The name a return is saved under, the same for the demo's and the user's. */
export function formFileName(form: "kdvp" | "div", taxYear: number): string {
  return `${form === "kdvp" ? "Doh_KDVP" : "Doh_Div"}_${String(taxYear)}.xml`;
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
    <div className="card form-file-card" {...explain("download.form", id)}>
      <div className="form-file-top">
        <span className="icon-tile" aria-hidden>
          <FileCodeIcon size={22} weight="bold" />
        </span>
        {chip}
      </div>
      <h2 className="form-file-title" {...explain("download.title", id)}>
        {form}
      </h2>
      <p className="muted">{body}</p>
      <p>
        <code className="code-badge" {...explain("download.fileName", id)}>
          {built?.fileName ?? fileName}
        </code>
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
          {...explain("download.button", id)}
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
          {...explain("download.button", id)}
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
  demo,
  returns: source,
  onBack,
  onRestart,
}: {
  readonly preview: ReturnPreview;
  /** Whether these are the demo's files, which must never be imported. */
  readonly demo: boolean;
  /**
   * The returns the preview shows: written already (the user's own, with
   * the review), or a writer awaited when the step opens (the demo's).
   */
  readonly returns: BuiltReturns | (() => Promise<BuiltReturns>);
  readonly onBack: () => void;
  readonly onRestart: () => void;
}) {
  const { locale, t } = useI18n();
  const [writing, setWriting] = useState<Writing>(
    typeof source === "function"
      ? { status: "preparing" }
      : { status: "ready", returns: source },
  );
  useEffect(() => {
    if (typeof source !== "function") {
      setWriting({ status: "ready", returns: source });
      return;
    }
    let current = true;
    source().then(
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
  }, [source]);
  const returns = writing.status === "ready" ? writing.returns : null;
  const deadline = formatDate(filingDeadline(preview.taxYear), locale);
  const lists = preview.securities.length;
  const payments = preview.dividends.length;
  const forms = [
    lists === 0 && returns?.kdvp.needed !== true ? null : (
      <FormCard
        key="kdvp"
        id="kdvp"
        form={t.download.kdvpTitle}
        body={
          lists === 0
            ? t.download.kdvpNone
            : plural(lists, locale, t.download.kdvpBody)
        }
        fileName={formFileName("kdvp", preview.taxYear)}
        built={returns?.kdvp ?? null}
      />
    ),
    payments === 0 && returns?.div.needed !== true ? null : (
      <FormCard
        key="div"
        id="div"
        form={t.download.divTitle}
        body={
          payments === 0
            ? t.download.divNone
            : plural(payments, locale, t.download.divBody)
        }
        fileName={formFileName("div", preview.taxYear)}
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
          ) : demo ? (
            <Note tone="warn">{t.download.demoFiles}</Note>
          ) : (
            <Note tone="neutral">{t.download.ownFiles}</Note>
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
