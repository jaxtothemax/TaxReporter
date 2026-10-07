/**
 * Adding broker exports. Files are recorded by name and size only: nothing
 * here reads their contents, because the parsers are not built yet.
 */
import {
  FileCodeIcon,
  FileCsvIcon,
  FileXIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Text,
} from "@radix-ui/themes";
import { useRef, useState, type DragEvent } from "react";

import { formatDate, formatKilobytes, plural } from "../i18n/format";
import { useI18n } from "../i18n/i18n";
import type { AddedFile, WizardState } from "../state/wizard";
import { BrokerName, Note } from "../ui/bits";

function FileIcon({ file }: { readonly file: AddedFile }) {
  if (file.kind === "own" && !file.supported) {
    return <FileXIcon size={22} weight="bold" aria-hidden />;
  }
  return file.name.toLowerCase().endsWith(".xml") ? (
    <FileCodeIcon size={22} weight="bold" aria-hidden />
  ) : (
    <FileCsvIcon size={22} weight="bold" aria-hidden />
  );
}

function FileDetail({ file }: { readonly file: AddedFile }) {
  const { locale, t } = useI18n();
  if (file.kind === "own") {
    return file.supported ? (
      <Text size="2" color="gray">
        {t.files.ownFileDetail(formatKilobytes(file.size, locale))}
      </Text>
    ) : (
      <Text size="2" color="red">
        {t.files.unsupported}
      </Text>
    );
  }
  return (
    <Text size="2" color="gray">
      {t.files.coverage(
        t.brokers[file.broker],
        formatDate(file.firstDate, locale),
        formatDate(file.lastDate, locale),
        plural(file.rowsRead, locale, t.files.rows),
      )}
    </Text>
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
  const hasUnsupported = state.files.some(
    (f) => f.kind === "own" && !f.supported,
  );
  const error = !state.showErrors
    ? null
    : state.files.length === 0
      ? t.files.needFiles
      : hasUnsupported
        ? t.files.unsupportedBlocked
        : null;

  function take(list: FileList | null): void {
    if (list === null || list.length === 0) return;
    onAddFiles(
      Array.from(list, (file) => ({ name: file.name, size: file.size })),
    );
    setAnnouncement(plural(list.length, locale, t.files.announceAdded));
  }

  function remove(file: AddedFile): void {
    onRemoveFile(file.id);
    setAnnouncement(t.files.announceRemoved(file.name));
    // The focused button disappears with its row; keep focus in the list.
    listHeading.current?.focus();
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  }

  return (
    <Flex direction="column" gap="6">
      <Box className="measure">
        <Flex align="center" gap="3" mb="2" wrap="wrap">
          <Heading as="h1" size="7" tabIndex={-1}>
            {t.files.title}
          </Heading>
          <Badge size="2" variant="soft" color="gray">
            {t.files.taxYear(String(taxYear))}
          </Badge>
        </Flex>
        <Text as="p" size="3" color="gray">
          {t.files.intro}
        </Text>
      </Box>

      <div
        className={dragging ? "dropzone is-dragging" : "dropzone"}
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
        <UploadSimpleIcon
          size={28}
          weight="bold"
          aria-hidden
          className="accent-icon"
        />
        <Text as="p" size="4" weight="medium">
          {t.files.dropTitle}
        </Text>
        <Text as="p" size="2" color="gray">
          {t.files.dropBody}
        </Text>
        <Flex gap="3" wrap="wrap" justify="center" pt="2">
          <Button
            size="2"
            variant="soft"
            onClick={() => {
              input.current?.click();
            }}
          >
            {t.files.chooseButton}
          </Button>
          <Button
            size="2"
            variant="ghost"
            color="gray"
            onClick={onUseDemoFiles}
          >
            {t.files.demoButton}
          </Button>
        </Flex>
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

      <Box>
        <Heading as="h2" size="5" mb="3" ref={listHeading} tabIndex={-1}>
          {t.files.listTitle}
        </Heading>
        {state.files.length === 0 ? (
          <Text as="p" size="2" color="gray" className="empty-hint">
            {t.files.emptyList}
          </Text>
        ) : (
          <ul className="file-list">
            {state.files.map((file) => (
              <li key={file.id}>
                <span className="file-icon">
                  <FileIcon file={file} />
                </span>
                <Box className="file-text">
                  <Text
                    as="p"
                    size="3"
                    weight="medium"
                    className="file-name mono"
                  >
                    {file.name}
                  </Text>
                  <FileDetail file={file} />
                </Box>
                {file.kind === "demo" ? (
                  // Demo files are fixed: removing one would not change the demo review.
                  <Badge variant="soft" color="gray">
                    <BrokerName broker={file.broker} />
                  </Badge>
                ) : (
                  <IconButton
                    variant="ghost"
                    color="gray"
                    aria-label={t.files.remove(file.name)}
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
      </Box>

      {hasOwnFiles ? <Note tone="gray">{t.files.ownFilesNotice}</Note> : null}

      <Flex direction="column" gap="2" align="start">
        <Flex gap="3">
          <Button size="3" variant="soft" color="gray" onClick={onBack}>
            {t.nav.back}
          </Button>
          <Button size="3" onClick={onNext}>
            {t.nav.next}
          </Button>
        </Flex>
        {error === null ? null : (
          <Text size="2" color="red" role="alert">
            {error}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
