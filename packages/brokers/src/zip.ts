/**
 * A strict ZIP reader, of our own (ADR 0014 §1–3), for XLSX workbooks.
 * Every archive is hostile, and two readers that disagree about one file
 * let Excel show the user one workbook while TaxReporter reads another, so
 * this reads only archives laid out the one plain way spreadsheet software
 * writes them, and refuses the rest:
 *
 * - exactly one End of Central Directory record, ending at the end of the
 *   file, with the central directory directly before it, and the entries'
 *   local records tiling everything before that, in order, with no gap and
 *   no overlap: nothing can hide before, between or behind the entries;
 * - each local header agreeing with its central entry, and a data
 *   descriptor, where there is one, agreeing with both;
 * - no ZIP64, no second disk, no encryption; stored or DEFLATE only; only
 *   the general-purpose flags those need;
 * - names of printable ASCII, at most 256 bytes, with no backslash, no
 *   percent sign, no leading slash and no empty, `.` or `..` segment, unique
 *   without regard to case (as OPC compares part names); extra fields of at
 *   most 1 KiB, never ZIP64's, nor the Unicode path or comment that give a
 *   tool a second name;
 * - no record signature in the archive comment, where a second End of
 *   Central Directory record could hide from a reader that does not scan
 *   for it, and a DEFLATE entry no larger than any encoder makes one.
 *
 * Nothing is inflated until asked for, and then only within a budget
 * checked against the declared sizes first (LIMITS.inflatedBytes); each
 * entry inflates to exactly its declared size and CRC-32. Errors name a
 * rule, never a name or a byte from the archive.
 */
import { LIMITS, type ZipReason } from "@taxreporter/core";

import { crc32 } from "./crc32.js";
import { inflate, InflateError } from "./inflate.js";

/** The codes are core's, so a diagnostic can only carry one of them. */
export type ZipErrorCode = ZipReason;

export class ZipError extends Error {
  constructor(readonly code: ZipErrorCode) {
    super(`ZIP archive refused (${code})`);
  }
}

export interface ZipEntry {
  /** As written in the archive, case and all. */
  readonly name: string;
  readonly method: 0 | 8;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc: number;
  /** Where the entry's compressed data starts in the archive. */
  readonly dataOffset: number;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  /** The entry of a name, compared without regard to case, as OPC does. */
  find(name: string): ZipEntry | undefined;
  /**
   * The entries' contents, inflated only now, and only if their declared
   * sizes, with everything this archive inflated before, fit the budget.
   */
  read(entries: readonly ZipEntry[]): Uint8Array[];
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_SIZE = 30;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX_COMMENT = 0xffff;
const MAX_NAME_BYTES = 256;
const MAX_EXTRA_BYTES = 1024;
const ZIP64_EXTRA_ID = 0x0001;
/** Info-ZIP's Unicode path and comment fields, a second name for a tool. */
const UNICODE_EXTRA_IDS: ReadonlySet<number> = new Set([0x7075, 0x6375]);
/** The second byte pair of each ZIP record signature after "PK". */
const RECORD_KINDS: ReadonlySet<number> = new Set([
  0x0201, 0x0403, 0x0605, 0x0606, 0x0706, 0x0807,
]);

/** Flag bits: 0 encrypted, 6 strong encryption, 13 masked headers. */
const ENCRYPTION_FLAGS = (1 << 0) | (1 << 6) | (1 << 13);
/** Flag bits taken: 1–2 DEFLATE options, 3 data descriptor, 11 UTF-8 names. */
const DESCRIPTOR_FLAG = 1 << 3;
const ALLOWED_FLAGS = (1 << 1) | (1 << 2) | DESCRIPTOR_FLAG | (1 << 11);

const u16 = (b: Uint8Array, at: number) =>
  (b[at] as number) | ((b[at + 1] as number) << 8);
const u32 = (b: Uint8Array, at: number) =>
  ((b[at] as number) |
    ((b[at + 1] as number) << 8) |
    ((b[at + 2] as number) << 16) |
    ((b[at + 3] as number) << 24)) >>>
  0;

/** Throws unless [at, at + length) lies within the archive. */
function within(bytes: Uint8Array, at: number, length: number): void {
  if (at < 0 || length < 0 || at + length > bytes.length) {
    throw new ZipError("zipDirectory");
  }
}

/** The one End of Central Directory record that ends the file. */
function endRecord(bytes: Uint8Array): number {
  const last = bytes.length - EOCD_SIZE;
  if (last < 0) throw new ZipError("zipEnd");
  const first = Math.max(0, last - MAX_COMMENT);
  let found = -1;
  for (let at = last; at >= first; at -= 1) {
    if (u32(bytes, at) !== EOCD_SIGNATURE) continue;
    // A signature counts only where its comment ends the file exactly; a
    // second one that also does would make the archive two archives.
    if (at + EOCD_SIZE + u16(bytes, at + 20) !== bytes.length) continue;
    if (found !== -1) throw new ZipError("zipEnd");
    found = at;
  }
  if (found === -1) throw new ZipError("zipEnd");
  // A record signature in the comment would let a reader that takes the
  // last one, or scans for one, see another archive (ADR 0014 §2).
  for (let at = found + EOCD_SIZE; at + 4 <= bytes.length; at += 1) {
    if (
      bytes[at] === 0x50 &&
      bytes[at + 1] === 0x4b &&
      RECORD_KINDS.has(u16(bytes, at + 2))
    ) {
      throw new ZipError("zipEnd");
    }
  }
  return found;
}

/** Throws unless an extra field is short, well formed and not ZIP64's. */
function checkExtra(bytes: Uint8Array, at: number, length: number): void {
  if (length > MAX_EXTRA_BYTES) throw new ZipError("zipExtra");
  let pos = at;
  const end = at + length;
  while (pos < end) {
    if (pos + 4 > end) throw new ZipError("zipExtra");
    const id = u16(bytes, pos);
    const size = u16(bytes, pos + 2);
    if (id === ZIP64_EXTRA_ID) throw new ZipError("zip64");
    if (UNICODE_EXTRA_IDS.has(id)) throw new ZipError("zipExtra");
    pos += 4 + size;
  }
  if (pos !== end) throw new ZipError("zipExtra");
}

/** An entry name as bytes, checked, as a string. */
function entryName(bytes: Uint8Array, at: number, length: number): string {
  if (length === 0 || length > MAX_NAME_BYTES) throw new ZipError("zipName");
  let name = "";
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[at + i] as number;
    // Printable ASCII only: no control character, no byte past 0x7E, no
    // backslash and no percent-encoding, which a reader may decode.
    if (byte < 0x20 || byte > 0x7e || byte === 0x5c || byte === 0x25) {
      throw new ZipError("zipName");
    }
    name += String.fromCharCode(byte);
  }
  // One spelling per name: a reader that normalizes `xl/./a.xml` or
  // `xl//a.xml` would see two copies of one part. A folder's own entry
  // may end with a slash.
  const segments = name.split("/");
  if (segments.at(-1) === "" && segments.length > 1) segments.pop();
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new ZipError("zipName");
  }
  return name;
}

interface Central extends ZipEntry {
  readonly flags: number;
  readonly localOffset: number;
  readonly nameBytes: Uint8Array;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Where an entry's local record ends: past its data and its descriptor,
 * once both agree with the central entry.
 */
function localEnd(bytes: Uint8Array, entry: Central): number {
  const at = entry.localOffset;
  within(bytes, at, LOCAL_SIZE);
  if (u32(bytes, at) !== LOCAL_SIGNATURE) throw new ZipError("zipHeader");
  const flags = u16(bytes, at + 6);
  const method = u16(bytes, at + 8);
  const nameLength = u16(bytes, at + 26);
  const extraLength = u16(bytes, at + 28);
  if (flags !== entry.flags || method !== entry.method) {
    throw new ZipError("zipHeader");
  }
  within(bytes, at + LOCAL_SIZE, nameLength + extraLength);
  const name = bytes.subarray(at + LOCAL_SIZE, at + LOCAL_SIZE + nameLength);
  if (!sameBytes(name, entry.nameBytes)) throw new ZipError("zipHeader");
  checkExtra(bytes, at + LOCAL_SIZE + nameLength, extraLength);
  const dataOffset = at + LOCAL_SIZE + nameLength + extraLength;
  if (dataOffset !== entry.dataOffset) throw new ZipError("zipHeader");
  const dataEnd = dataOffset + entry.compressedSize;
  within(bytes, dataOffset, entry.compressedSize);
  if ((flags & DESCRIPTOR_FLAG) === 0) {
    if (
      u32(bytes, at + 14) !== entry.crc ||
      u32(bytes, at + 18) !== entry.compressedSize ||
      u32(bytes, at + 22) !== entry.size
    ) {
      throw new ZipError("zipHeader");
    }
    return dataEnd;
  }
  // A data descriptor follows the data, with or without its signature;
  // either way it must say what the central entry says.
  const matches = (from: number) =>
    from + 12 <= bytes.length &&
    u32(bytes, from) === entry.crc &&
    u32(bytes, from + 4) === entry.compressedSize &&
    u32(bytes, from + 8) === entry.size;
  if (
    dataEnd + 4 <= bytes.length &&
    u32(bytes, dataEnd) === DESCRIPTOR_SIGNATURE &&
    matches(dataEnd + 4)
  ) {
    return dataEnd + 16;
  }
  if (matches(dataEnd)) return dataEnd + 12;
  throw new ZipError("zipDescriptor");
}

/** Opens an archive: every structural rule above checked, nothing inflated. */
export function openZip(bytes: Uint8Array): ZipArchive {
  const end = endRecord(bytes);
  if (end >= 20 && u32(bytes, end - 20) === ZIP64_LOCATOR_SIGNATURE) {
    throw new ZipError("zip64");
  }
  const disk = u16(bytes, end + 4);
  const directoryDisk = u16(bytes, end + 6);
  const onDisk = u16(bytes, end + 8);
  const total = u16(bytes, end + 10);
  const directorySize = u32(bytes, end + 12);
  const directoryOffset = u32(bytes, end + 16);
  if (
    total === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new ZipError("zip64");
  }
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== total) {
    throw new ZipError("zipDisk");
  }
  // Counted before the directory is read, so its size bounds the work.
  if (total > LIMITS.zipEntries) throw new ZipError("zipEntries");
  if (directoryOffset + directorySize !== end) {
    throw new ZipError("zipDirectory");
  }

  const central: Central[] = [];
  const names = new Set<string>();
  let pos = directoryOffset;
  for (let n = 0; n < total; n += 1) {
    if (pos + CENTRAL_SIZE > end) throw new ZipError("zipDirectory");
    if (u32(bytes, pos) !== CENTRAL_SIGNATURE) {
      throw new ZipError("zipDirectory");
    }
    const flags = u16(bytes, pos + 8);
    const method = u16(bytes, pos + 10);
    const crc = u32(bytes, pos + 16);
    const compressedSize = u32(bytes, pos + 20);
    const size = u32(bytes, pos + 24);
    const nameLength = u16(bytes, pos + 28);
    const extraLength = u16(bytes, pos + 30);
    const commentLength = u16(bytes, pos + 32);
    const startDisk = u16(bytes, pos + 34);
    const localOffset = u32(bytes, pos + 42);
    const variable = nameLength + extraLength + commentLength;
    if (pos + CENTRAL_SIZE + variable > end) {
      throw new ZipError("zipDirectory");
    }
    if ((flags & ENCRYPTION_FLAGS) !== 0) throw new ZipError("zipEncrypted");
    if ((flags & ~(ALLOWED_FLAGS | ENCRYPTION_FLAGS)) !== 0) {
      throw new ZipError("zipFlags");
    }
    if (method !== 0 && method !== 8) throw new ZipError("zipMethod");
    if (
      compressedSize === 0xffffffff ||
      size === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new ZipError("zip64");
    }
    if (startDisk !== 0) throw new ZipError("zipDisk");
    if (method === 0 && compressedSize !== size) {
      throw new ZipError("zipStoredSize");
    }
    // A stored entry's sizes are known before it is written: a descriptor
    // after it only gives a second place to state them.
    if (method === 0 && (flags & DESCRIPTOR_FLAG) !== 0) {
      throw new ZipError("zipFlags");
    }
    // No encoder makes a DEFLATE stream larger than stored blocks would:
    // 5 bytes a block of 65,535, and a little more. A larger one costs
    // decoding time the budget, which counts output, does not charge.
    if (
      method === 8 &&
      compressedSize > size + 5 * Math.ceil(size / 65_535) + 64
    ) {
      throw new ZipError("zipInflate");
    }
    const nameAt = pos + CENTRAL_SIZE;
    const name = entryName(bytes, nameAt, nameLength);
    const folded = name.toLowerCase();
    if (names.has(folded)) throw new ZipError("zipDuplicate");
    names.add(folded);
    checkExtra(bytes, nameAt + nameLength, extraLength);
    if (commentLength > MAX_EXTRA_BYTES) throw new ZipError("zipExtra");
    within(bytes, localOffset, LOCAL_SIZE);
    const localNameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    central.push({
      name,
      method,
      compressedSize,
      size,
      crc,
      flags,
      localOffset,
      nameBytes: bytes.subarray(nameAt, nameAt + nameLength),
      dataOffset: localOffset + LOCAL_SIZE + localNameLength + localExtraLength,
    });
    pos += CENTRAL_SIZE + variable;
  }
  if (pos !== end) throw new ZipError("zipDirectory");

  // The local records, in file order, must tile [0, directoryOffset).
  const ordered = [...central].sort((a, b) => a.localOffset - b.localOffset);
  let next = 0;
  for (const entry of ordered) {
    if (entry.localOffset !== next) throw new ZipError("zipLayout");
    next = localEnd(bytes, entry);
  }
  if (next !== directoryOffset) throw new ZipError("zipLayout");

  const entries: ZipEntry[] = central.map((entry) => ({
    name: entry.name,
    method: entry.method,
    compressedSize: entry.compressedSize,
    size: entry.size,
    crc: entry.crc,
    dataOffset: entry.dataOffset,
  }));
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  let inflated = 0;

  return {
    entries,
    find: (name) => byName.get(name.toLowerCase()),
    read(wanted) {
      const declared = wanted.reduce((sum, entry) => sum + entry.size, 0);
      // Checked against what the archive declares, before a byte is
      // inflated: a bomb is refused unopened, not stopped halfway.
      if (inflated + declared > LIMITS.inflatedBytes) {
        throw new ZipError("zipBudget");
      }
      inflated += declared;
      return wanted.map((entry) => {
        const data = bytes.subarray(
          entry.dataOffset,
          entry.dataOffset + entry.compressedSize,
        );
        let content: Uint8Array;
        try {
          content =
            entry.method === 0 ? data.slice() : inflate(data, entry.size);
        } catch (error) {
          if (error instanceof InflateError) throw new ZipError("zipInflate");
          throw error;
        }
        if (crc32(content) !== entry.crc) throw new ZipError("zipChecksum");
        return content;
      });
    },
  };
}
