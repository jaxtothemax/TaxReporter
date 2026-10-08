/**
 * Reading an export from disk. Every imported file is hostile (CLAUDE.md,
 * "Secure code"), so the bytes are checked before any parser sees them:
 * only a regular file, of a bounded size read through the opened descriptor
 * (a FIFO or /dev/zero would otherwise never end), not a ZIP, spreadsheet,
 * PDF or UTF-16 file in disguise, and valid UTF-8.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { basename } from "node:path";

/** Far above a year of any broker's history; checked before reading. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export type IntakeRefusal =
  | "unreadable"
  | "notAFile"
  | "tooLarge"
  | "changedWhileReading"
  | "zip"
  | "spreadsheet"
  | "pdf"
  | "utf16"
  | "binary"
  | "notUtf8";

export type Intake =
  | { readonly ok: true; readonly name: string; readonly text: string }
  | {
      readonly ok: false;
      readonly name: string;
      readonly reason: IntakeRefusal;
    };

const startsWith = (bytes: Uint8Array, ...prefix: number[]) =>
  prefix.every((byte, i) => bytes[i] === byte);

/** What the first bytes say a file really is, when it is no text export. */
function disguise(bytes: Uint8Array): IntakeRefusal | null {
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) return "zip"; // ZIP, XLSX
  if (startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0)) return "spreadsheet"; // XLS
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (startsWith(bytes, 0xff, 0xfe) || startsWith(bytes, 0xfe, 0xff)) {
    return "utf16";
  }
  return bytes.includes(0) ? "binary" : null;
}

/**
 * Reads one export. The name returned is the file's base name, never its
 * path: it labels every event and diagnostic from the file.
 */
export function readExport(path: string): Intake {
  const name = basename(path);
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { ok: false, name, reason: "unreadable" };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, name, reason: "notAFile" };
    if (stat.size > MAX_FILE_BYTES) {
      return { ok: false, name, reason: "tooLarge" };
    }
    // One byte more than the size said, to catch a file that grows.
    const buffer = new Uint8Array(stat.size + 1);
    let length = 0;
    for (;;) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
      if (length > stat.size) {
        return { ok: false, name, reason: "changedWhileReading" };
      }
    }
    const bytes = buffer.subarray(0, length);
    const refused = disguise(bytes);
    if (refused !== null) return { ok: false, name, reason: refused };
    try {
      // fatal: a byte sequence that is not UTF-8 refuses the file instead of
      // turning into replacement characters; a UTF-8 byte-order mark goes.
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { ok: true, name, text };
    } catch {
      return { ok: false, name, reason: "notUtf8" };
    }
  } catch {
    return { ok: false, name, reason: "unreadable" };
  } finally {
    closeSync(fd);
  }
}

/**
 * Labels for a set of files, unique even where two share a base name: the
 * engine treats one label as one file, so two different "export.csv" files
 * must not look like a file that repeats its own rows.
 */
export function uniqueLabels(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let label = name;
    for (let n = 2; used.has(label); n += 1) label = `${name} (${String(n)})`;
    used.add(label);
    return label;
  });
}
