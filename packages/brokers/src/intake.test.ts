/**
 * The checks on a file's bytes before any parser sees them (ADR 0011 §1),
 * each at the content it refuses, whatever the file is called.
 */
import { LIMITS, type FileId } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { importFile } from "./adapter.js";
import { decodeUtf8, sniff } from "./intake.js";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("sniff", () => {
  it("names the formats that are no text export", () => {
    expect(sniff(bytes(0x50, 0x4b, 0x03, 0x04, 0x14))).toBe("zip");
    expect(sniff(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1))).toBe("spreadsheet");
    expect(sniff(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(sniff(bytes(0x1f, 0x8b, 0x08))).toBe("gzip");
    expect(sniff(bytes(0xff, 0xfe, 0x41, 0x00))).toBe("utf16");
    expect(sniff(bytes(0xfe, 0xff, 0x00, 0x41))).toBe("utf16");
    expect(sniff(bytes(0xff, 0xfe, 0x00, 0x00))).toBe("utf32");
    expect(sniff(bytes(0x00, 0x00, 0xfe, 0xff))).toBe("utf32");
    // UTF-16 without a mark still has a NUL in every ASCII character.
    expect(sniff(bytes(0x41, 0x00, 0x42, 0x00))).toBe("binary");
  });

  it("passes text, a UTF-8 byte-order mark included", () => {
    expect(sniff(new TextEncoder().encode("Action,Time\n"))).toBeNull();
    expect(sniff(bytes(0xef, 0xbb, 0xbf, 0x41))).toBeNull();
    expect(sniff(bytes())).toBeNull();
  });

  it("takes a file of the byte cap, and refuses one byte more", () => {
    // A file of zeros is binary, but not too large.
    expect(sniff(new Uint8Array(LIMITS.fileBytes))).toBe("binary");
    expect(sniff(new Uint8Array(LIMITS.fileBytes + 1))).toBe("tooLarge");
  });
});

describe("decodeUtf8", () => {
  it("decodes UTF-8 and drops its byte-order mark", () => {
    expect(decodeUtf8(bytes(0xef, 0xbb, 0xbf, 0xc5, 0xa1))).toBe("š");
  });

  it("refuses bytes that are not UTF-8 rather than repair them", () => {
    // Latin-1 "š", an overlong "/", and a lone surrogate.
    expect(decodeUtf8(bytes(0x9a))).toBeNull();
    expect(decodeUtf8(bytes(0xc0, 0xaf))).toBeNull();
    expect(decodeUtf8(bytes(0xed, 0xa0, 0x80))).toBeNull();
  });
});

describe("importFile's intake", () => {
  const file = (content: Uint8Array) =>
    importFile({
      bytes: content,
      fileId: "0123456789abcdef" as FileId,
      accountGroup: 1,
    }).diagnostics;

  it("refuses a disguised file before any adapter reads it", () => {
    expect(file(bytes(0x50, 0x4b, 0x03, 0x04))).toEqual([
      { severity: "blocking", code: "fileRefused", params: { reason: "zip" } },
    ]);
    expect(file(bytes(0x41, 0x2c, 0x9a, 0x0a))).toEqual([
      {
        severity: "blocking",
        code: "fileRefused",
        params: { reason: "notUtf8" },
      },
    ]);
  });
});
