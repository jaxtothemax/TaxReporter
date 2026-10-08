/**
 * Reading an export from disk. Every imported file is hostile (CLAUDE.md,
 * "Secure code"), so only a regular file is read, of a bounded size, through
 * the opened descriptor: a FIFO or /dev/zero would otherwise never end. What
 * the bytes are is `importFile`'s to check, the same in the CLI and the web
 * app (ADR 0011 §1).
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { basename } from "node:path";

import { LIMITS } from "@taxreporter/core";

/** Far above a year of any broker's history; checked before reading. */
export const MAX_FILE_BYTES = LIMITS.fileBytes;

/**
 * Non-blocking, so that opening a FIFO with no writer returns at once
 * instead of waiting forever, and never as the controlling terminal; fstat
 * then refuses anything that is not a regular file. Reading a regular file
 * is the same either way. Windows has neither flag.
 */
const OPEN_FLAGS =
  constants.O_RDONLY |
  ((constants.O_NONBLOCK as number | undefined) ?? 0) |
  ((constants.O_NOCTTY as number | undefined) ?? 0);

/**
 * A name as the terminal may show it: control, format and separator
 * characters become "?", so a file's name cannot move the cursor, rewrite a
 * line or turn text around.
 */
export function printable(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?");
}

export type IntakeRefusal =
  "unreadable" | "notAFile" | "tooLarge" | "changedWhileReading";

export type Intake =
  | { readonly ok: true; readonly name: string; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly name: string;
      readonly reason: IntakeRefusal;
    };

/**
 * Reads one file's bytes. The name returned is the file's base name, never
 * its path, which can hold the user's own name: it is for the screen only.
 */
export function readExport(path: string): Intake {
  const name = printable(basename(path));
  let fd: number;
  try {
    fd = openSync(path, OPEN_FLAGS);
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
    return { ok: true, name, bytes: buffer.subarray(0, length) };
  } catch {
    return { ok: false, name, reason: "unreadable" };
  } finally {
    closeSync(fd);
  }
}

/**
 * Labels for a set of files, unique even where two share a base name, so
 * the user can tell which file a finding is about.
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
