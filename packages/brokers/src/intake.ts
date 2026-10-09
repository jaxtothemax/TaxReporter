/**
 * The bytes of an import, checked before any parser sees them (ADR 0011
 * §1). Every imported file is hostile (CLAUDE.md, "Secure code"): it is
 * bounded, sniffed for the formats that are no text export whatever the
 * file is called, and decoded as UTF-8 that refuses rather than repairs.
 */
import { LIMITS, type FileRefusal } from "@taxreporter/core";

const startsWith = (bytes: Uint8Array, ...prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);

/**
 * Why the bytes are no export this tool reads, or null. The extension is
 * never consulted: a renamed spreadsheet is still a spreadsheet.
 */
export function sniff(bytes: Uint8Array): FileRefusal | null {
  if (bytes.length > LIMITS.fileBytes) return "tooLarge";
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) return "zip"; // ZIP, XLSX
  if (startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0)) return "spreadsheet"; // XLS
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (startsWith(bytes, 0x1f, 0x8b)) return "gzip";
  // UTF-32 first: its little-endian mark begins like UTF-16's.
  if (
    startsWith(bytes, 0xff, 0xfe, 0x00, 0x00) ||
    startsWith(bytes, 0x00, 0x00, 0xfe, 0xff)
  ) {
    return "utf32";
  }
  if (startsWith(bytes, 0xff, 0xfe) || startsWith(bytes, 0xfe, 0xff)) {
    return "utf16";
  }
  return bytes.includes(0) ? "binary" : null;
}

/**
 * The platform's TextDecoder, which Node and every browser and worker have.
 * Typed here because the package builds against no platform's types.
 */
type Utf8Decoder = new (
  label: "utf-8",
  options: { readonly fatal: true },
) => { decode(input: Uint8Array): string };

const Decoder = (globalThis as unknown as { TextDecoder: Utf8Decoder })
  .TextDecoder;

/**
 * The bytes as text, or null when they are not UTF-8: a byte sequence that
 * is not refuses the file instead of turning into replacement characters.
 * A UTF-8 byte-order mark goes.
 */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new Decoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
