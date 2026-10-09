/**
 * A small ZIP writer for the tests: archives laid out as spreadsheet
 * software writes them, unless a test says otherwise, so the ZIP reader
 * and the workbook reader can be tried on every shape. Node's zlib
 * compresses; only the tests use it, and the build leaves this out.
 */
import { deflateRawSync } from "node:zlib";

import { crc32 } from "../crc32.js";

export interface Part {
  readonly name: string;
  readonly content: Uint8Array;
  readonly method?: 0 | 8;
  /** Write sizes and CRC in a data descriptor after the data. */
  readonly descriptor?: "signed" | "unsigned";
  readonly flags?: number;
  readonly extra?: Uint8Array;
  /** Bytes of the name as written, where the test needs other bytes. */
  readonly rawName?: Uint8Array;
  /** The DEFLATE stream as written, where the test makes its own. */
  readonly deflated?: Uint8Array;
}

export interface Options {
  readonly comment?: Uint8Array;
  /** Bytes before the first entry. */
  readonly prefix?: Uint8Array;
  /** Bytes between the last entry and the central directory. */
  readonly gap?: Uint8Array;
  /** Changes to a central entry's fields, by entry index. */
  readonly central?: (index: number, header: DataView) => void;
  /** Changes to a local header's fields, by entry index. */
  readonly local?: (index: number, header: DataView) => void;
  /** Changes to the end record. */
  readonly end?: (record: DataView) => void;
}

export const encode = (text: string) => new TextEncoder().encode(text);

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A ZIP archive laid out as spreadsheet software writes it, unless told otherwise. */
export function makeZip(
  parts: readonly Part[],
  options: Options = {},
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  if (options.prefix !== undefined) {
    chunks.push(options.prefix);
    offset += options.prefix.length;
  }
  parts.forEach((part, index) => {
    const method = part.method ?? 8;
    const data =
      method === 8
        ? (part.deflated ?? new Uint8Array(deflateRawSync(part.content)))
        : part.content;
    const crc = crc32(part.content);
    const name = part.rawName ?? encode(part.name);
    const extra = part.extra ?? new Uint8Array(0);
    const flags = (part.flags ?? 0) | (part.descriptor === undefined ? 0 : 8);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    const inLocal = part.descriptor === undefined;
    local.setUint32(14, inLocal ? crc : 0, true);
    local.setUint32(18, inLocal ? data.length : 0, true);
    local.setUint32(22, inLocal ? part.content.length : 0, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, extra.length, true);
    options.local?.(index, local);
    const record = [new Uint8Array(local.buffer), name, extra, data];
    if (part.descriptor !== undefined) {
      const d = new DataView(
        new ArrayBuffer(part.descriptor === "signed" ? 16 : 12),
      );
      let at = 0;
      if (part.descriptor === "signed") {
        d.setUint32(0, 0x08074b50, true);
        at = 4;
      }
      d.setUint32(at, crc, true);
      d.setUint32(at + 4, data.length, true);
      d.setUint32(at + 8, part.content.length, true);
      record.push(new Uint8Array(d.buffer));
    }
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, flags, true);
    central.setUint16(10, method, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, part.content.length, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, extra.length, true);
    central.setUint32(42, offset, true);
    options.central?.(index, central);
    centrals.push(concat([new Uint8Array(central.buffer), name, extra]));
    const bytes = concat(record);
    chunks.push(bytes);
    offset += bytes.length;
  });
  if (options.gap !== undefined) {
    chunks.push(options.gap);
    offset += options.gap.length;
  }
  const directory = concat(centrals);
  const comment = options.comment ?? new Uint8Array(0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, parts.length, true);
  end.setUint16(10, parts.length, true);
  end.setUint32(12, directory.length, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, comment.length, true);
  options.end?.(end);
  return concat([...chunks, directory, new Uint8Array(end.buffer), comment]);
}
