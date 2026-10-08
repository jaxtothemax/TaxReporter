/**
 * Adding broker exports. The engine worker reads each file as it is added
 * (ADR 0013): a file's row then says which broker's export it is and which
 * days it covers, or why it cannot be read. Two or more Trading 212 files
 * raise the question of whether they are one account, answered in place.
 */
import {
  ArrowRightIcon,
  FileCodeIcon,
  FileCsvIcon,
  FileXIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { AccountChoice } from "@taxreporter/pipeline";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { demoPreview } from "../demo/demoPreview";
import type { FileSummary } from "../engine/protocol";
import {
  formatDate,
  formatKilobytes,
  formatNumber,
  plural,
} from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import { findingText, type FindingContext } from "../i18n/present";
import type { Finding } from "../model/preview";
import {
  asksAccounts,
  blockingReason,
  isSupportedFile,
  labelsOf,
  summaryOf,
  type AddedFile,
  type WizardState,
} from "../state/wizard";
import { BrokerName } from "../ui/bits";
import { Button, Chip, cx, IconButton, Note } from "../ui/kit";

const UNREADABLE = new Set(["refused", "clash", "notRead"]);

function isRefused(file: AddedFile, summary: FileSummary | undefined): boolean {
  if (file.kind !== "own") return false;
  return (
    !file.supported || (summary !== undefined && UNREADABLE.has(summary.status))
  );
}

function FileIcon({
  file,
  refused,
}: {
  readonly file: AddedFile;
  readonly refused: boolean;
}) {
  if (refused) return <FileXIcon size={20} weight="bold" />;
  return file.name.toLowerCase().endsWith(".xml") ? (
    <FileCodeIcon size={20} weight="bold" />
  ) : (
    <FileCsvIcon size={20} weight="bold" />
  );
}

const blockingOf = (findings: readonly Finding[]) =>
  findings.filter((f) => f.severity === "blocking");

function FileDetail({
  file,
  state,
  context,
}: {
  readonly file: AddedFile;
  readonly state: WizardState;
  readonly context: FindingContext;
}) {
  const { locale, t } = useI18n();
  if (file.kind === "demo") {
    return (
      <p className="file-detail">
        {t.files.coverage(
          t.brokers[file.broker],
          formatDate(file.firstDate, locale),
          formatDate(file.lastDate, locale),
          plural(file.rowsRead, locale, t.files.rows),
        )}
      </p>
    );
  }
  if (!file.supported) {
    return <p className="file-detail is-error">{t.files.unsupported}</p>;
  }
  const summary = summaryOf(state, file.id);
  if (summary === undefined) {
    const size = formatKilobytes(file.size, locale);
    return (
      <p className="file-detail">
        {state.reading.status === "failed"
          ? size
          : `${size}, ${t.files.reading}`}
      </p>
    );
  }
  const said = (findings: readonly Finding[]) =>
    findings.map((f, i) => (
      <p key={`${f.code}-${String(i)}`} className="file-detail is-error">
        {findingText(f, context)}
      </p>
    ));
  switch (summary.status) {
    case "refused":
      return <>{said(blockingOf(summary.findings))}</>;
    case "repeat":
      return (
        <p className="file-detail">
          {t.files.readOnce(
            summary.sameAs === null
              ? t.review.unnamedFile
              : context.fileName(summary.sameAs),
          )}
        </p>
      );
    case "clash":
      return <p className="file-detail is-error">{t.files.clashed}</p>;
    case "notRead":
      return <p className="file-detail is-error">{t.files.notRead}</p>;
    case "read": {
      const broker = summary.broker === null ? "" : t.brokers[summary.broker];
      const rows = plural(summary.rows, locale, t.files.rows);
      return (
        <>
          <p className="file-detail">
            {summary.firstDate === null || summary.lastDate === null
              ? t.files.noDatedRows(broker, rows)
              : t.files.coverage(
                  broker,
                  formatDate(summary.firstDate, locale),
                  formatDate(summary.lastDate, locale),
                  rows,
                )}
          </p>
          {said(blockingOf(summary.findings))}
        </>
      );
    }
  }
}

function AccountQuestion({
  accounts,
  onChange,
}: {
  readonly accounts: AccountChoice;
  readonly onChange: (accounts: AccountChoice) => void;
}) {
  const { t } = useI18n();
  const options: readonly (readonly [AccountChoice, string])[] = [
    ["same", t.files.accountsSame],
    ["separate", t.files.accountsSeparate],
  ];
  return (
    <fieldset className="card question-card">
      <legend className="question-title">{t.files.accountsTitle}</legend>
      <p className="muted small">{t.files.accountsBody}</p>
      <div className="choices">
        {options.map(([value, label]) => (
          <label key={value} className="choice">
            <input
              type="radio"
              name="trading212-accounts"
              value={value}
              checked={accounts === value}
              onChange={() => {
                onChange(value);
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FilesStep({
  state,
  taxYear,
  onAddFiles,
  onRemoveFile,
  onSetAccounts,
  onUseDemoFiles,
  onBack,
  onNext,
}: {
  readonly state: WizardState;
  readonly taxYear: number;
  readonly onAddFiles: (files: readonly File[]) => void;
  readonly onRemoveFile: (id: string) => void;
  readonly onSetAccounts: (accounts: AccountChoice) => void;
  readonly onUseDemoFiles: () => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  const { locale, t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const [dragging, setDragging] = useState(false);
  // Spoken by screen readers: adding or removing a file changes the list but
  // moves no focus, so the change would otherwise go unannounced.
  const [announcement, setAnnouncement] = useState("");
  const hasOwnFiles = state.files.some((f) => f.kind === "own");
  const labels = labelsOf(state.files);
  const { reading } = state;
  const context: FindingContext = {
    locale,
    symbols: reading.status === "read" ? reading.reply.symbols : {},
    fileName: (position) => {
      const id =
        reading.status === "idle" ? undefined : reading.fileIds[position];
      const label = id === undefined ? undefined : labels.get(id);
      return label ?? t.review.unnamedFile;
    },
  };
  const together =
    reading.status === "read" ? blockingOf(reading.reply.findings) : [];
  const reason = blockingReason(state, "files");
  const error = !state.showErrors
    ? null
    : reason === "needFiles"
      ? t.files.needFiles
      : reason === "unsupportedFile" || reason === "unreadableFile"
        ? t.files.unsupportedBlocked
        : reason === "stillReading"
          ? t.files.stillReading
          : reason === "readFailed"
            ? t.files.readFailed
            : null;

  // Each message names the new total, so two identical actions in a row are
  // still two different announcements (React drops an unchanged string).
  function announce(message: string, total: number): void {
    setAnnouncement(
      `${message} ${plural(total, locale, t.files.announceTotal)}`,
    );
  }

  // The end of a reading is said too: nothing on screen moves focus to it.
  const status = reading.status;
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (status === "read") setAnnouncement(t.files.announceRead);
    if (status === "failed") setAnnouncement(t.files.announceFailed);
  }, [status, t]);

  function take(list: FileList | null): void {
    if (list === null || list.length === 0) return;
    const chosen = Array.from(list);
    onAddFiles(chosen);
    const ownBefore = state.files.filter((f) => f.kind === "own").length;
    const refused = chosen.filter((file) => !isSupportedFile(file.name)).length;
    // Say at once that a file cannot be read, not only after Continue.
    const added = [
      plural(chosen.length, locale, t.files.announceAdded),
      refused === 0
        ? null
        : plural(refused, locale, t.files.announceUnsupported),
      refused === chosen.length ? null : t.files.announceReading,
    ]
      .filter(Boolean)
      .join(" ");
    announce(added, ownBefore + chosen.length);
  }

  function remove(file: AddedFile): void {
    onRemoveFile(file.id);
    announce(t.files.announceRemoved(file.name), state.files.length - 1);
    // The focused button disappears with its row; keep focus in the list.
    listHeading.current?.focus();
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div className="screen-title-row">
          <h1 tabIndex={-1}>{t.files.title}</h1>
          <Chip tone="accent">{t.files.taxYear(String(taxYear))}</Chip>
        </div>
        <p className="lead">{t.files.intro}</p>
      </header>

      <div
        className={cx("dropzone", dragging && "is-dragging")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          // Moving over the zone's own text and buttons fires dragleave too;
          // only leaving the zone itself ends the highlight.
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDragging(false);
          }
        }}
        onDrop={onDrop}
      >
        <span className="icon-tile icon-tile-lg" aria-hidden>
          <UploadSimpleIcon size={26} weight="bold" />
        </span>
        <p className="drop-title">{t.files.dropTitle}</p>
        <p className="muted">{t.files.dropBody}</p>
        <div className="drop-actions">
          <Button
            onClick={() => {
              input.current?.click();
            }}
          >
            {t.files.chooseButton}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onUseDemoFiles();
              announce(t.files.announceDemo, demoPreview.files.length);
            }}
          >
            {t.files.demoButton}
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept=".csv,.xml,text/csv,application/xml,text/xml"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            take(event.currentTarget.files);
            // Allow choosing the same file again after removing it.
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="card list-card">
        <div className="card-head">
          <h2 ref={listHeading} tabIndex={-1}>
            {t.files.listTitle}
          </h2>
          {state.files.length === 0 ? null : (
            <span className="count" aria-hidden>
              {formatNumber(String(state.files.length), locale)}
            </span>
          )}
        </div>
        {state.files.length === 0 ? (
          <p className="empty-hint">{t.files.emptyList}</p>
        ) : (
          <ul className="file-list" role="list">
            {state.files.map((file) => {
              const refused = isRefused(file, summaryOf(state, file.id));
              return (
                <li key={file.id} className="file-row">
                  <span
                    className={cx(
                      "icon-tile",
                      "icon-tile-sm",
                      refused && "is-danger",
                    )}
                    aria-hidden
                  >
                    <FileIcon file={file} refused={refused} />
                  </span>
                  <div className="file-text">
                    <p className="file-name mono">
                      {labels.get(file.id) ?? file.name}
                    </p>
                    <FileDetail file={file} state={state} context={context} />
                  </div>
                  {file.kind === "demo" ? (
                    // Demo files are fixed: removing one would not change the demo review.
                    <Chip>
                      <BrokerName broker={file.broker} />
                    </Chip>
                  ) : (
                    <IconButton
                      label={t.files.remove(file.name)}
                      onClick={() => {
                        remove(file);
                      }}
                    >
                      <TrashIcon size={18} weight="bold" aria-hidden />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </div>

      {reading.status === "failed" ? (
        <Note tone="danger">{t.files.readFailed}</Note>
      ) : null}

      {asksAccounts(state) ? (
        <AccountQuestion accounts={state.accounts} onChange={onSetAccounts} />
      ) : null}

      {together.length === 0 ? null : (
        <section className="card problems-card" aria-labelledby="problems">
          <h2 id="problems">{t.files.problemsTitle}</h2>
          <p className="muted small">{t.files.problemsBody}</p>
          <div className="note-stack">
            {together.map((f, i) => (
              <Note key={`${f.code}-${String(i)}`} tone="danger">
                {findingText(f, context)}
              </Note>
            ))}
          </div>
        </section>
      )}

      {hasOwnFiles ? (
        <Note tone="neutral">{t.files.ownFilesNotice}</Note>
      ) : null}

      <div className="actions">
        <div className="actions-row">
          <Button size="lg" onClick={onBack}>
            {t.nav.back}
          </Button>
          <Button variant="primary" size="lg" onClick={onNext}>
            {t.nav.next}
            <ArrowRightIcon size={18} weight="bold" aria-hidden />
          </Button>
        </div>
        {error === null ? null : (
          <p className="field-error" role="alert">
            <WarningCircleIcon size={16} weight="bold" aria-hidden />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
