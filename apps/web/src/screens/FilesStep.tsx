/**
 * Adding broker exports. Files are recorded by name and size only: nothing
 * here reads their contents, because the parsers are not built yet.
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
import { useRef, useState, type DragEvent } from "react";

import { demoPreview } from "../demo/demoPreview";
import {
  formatDate,
  formatKilobytes,
  formatNumber,
  plural,
} from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import {
  isSupportedFile,
  type AddedFile,
  type WizardState,
} from "../state/wizard";
import { BrokerName } from "../ui/bits";
import { Button, Chip, cx, IconButton, Note } from "../ui/kit";

function isRefused(file: AddedFile): boolean {
  return file.kind === "own" && !file.supported;
}

function FileIcon({ file }: { readonly file: AddedFile }) {
  if (isRefused(file)) return <FileXIcon size={20} weight="bold" />;
  return file.name.toLowerCase().endsWith(".xml") ? (
    <FileCodeIcon size={20} weight="bold" />
  ) : (
    <FileCsvIcon size={20} weight="bold" />
  );
}

function FileDetail({ file }: { readonly file: AddedFile }) {
  const { locale, t } = useI18n();
  if (file.kind === "own") {
    return file.supported ? (
      <p className="file-detail">
        {t.files.ownFileDetail(formatKilobytes(file.size, locale))}
      </p>
    ) : (
      <p className="file-detail is-error">{t.files.unsupported}</p>
    );
  }
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

export function FilesStep({
  state,
  taxYear,
  onAddFiles,
  onRemoveFile,
  onUseDemoFiles,
  onBack,
  onNext,
}: {
  readonly state: WizardState;
  readonly taxYear: number;
  readonly onAddFiles: (
    files: readonly { readonly name: string; readonly size: number }[],
  ) => void;
  readonly onRemoveFile: (id: string) => void;
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
  const hasUnsupported = state.files.some(isRefused);
  const error = !state.showErrors
    ? null
    : state.files.length === 0
      ? t.files.needFiles
      : hasUnsupported
        ? t.files.unsupportedBlocked
        : null;

  // Each message names the new total, so two identical actions in a row are
  // still two different announcements (React drops an unchanged string).
  function announce(message: string, total: number): void {
    setAnnouncement(
      `${message} ${plural(total, locale, t.files.announceTotal)}`,
    );
  }

  function take(list: FileList | null): void {
    if (list === null || list.length === 0) return;
    onAddFiles(
      Array.from(list, (file) => ({ name: file.name, size: file.size })),
    );
    const ownBefore = state.files.filter((f) => f.kind === "own").length;
    const refused = Array.from(list).filter(
      (file) => !isSupportedFile(file.name),
    ).length;
    // Say at once that a file cannot be read, not only after Continue.
    const added = [
      plural(list.length, locale, t.files.announceAdded),
      refused === 0
        ? null
        : plural(refused, locale, t.files.announceUnsupported),
    ]
      .filter(Boolean)
      .join(" ");
    announce(
      ownBefore === 0 ? `${added} ${t.files.ownFilesNotice}` : added,
      ownBefore + list.length,
    );
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
            {state.files.map((file) => (
              <li key={file.id} className="file-row">
                <span
                  className={cx(
                    "icon-tile",
                    "icon-tile-sm",
                    isRefused(file) && "is-danger",
                  )}
                  aria-hidden
                >
                  <FileIcon file={file} />
                </span>
                <div className="file-text">
                  <p className="file-name mono">{file.name}</p>
                  <FileDetail file={file} />
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
            ))}
          </ul>
        )}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </div>

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
