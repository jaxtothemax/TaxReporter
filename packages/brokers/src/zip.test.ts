/**
 * The ZIP reader on archives a small writer here makes: the plain layout
 * spreadsheet software writes reads back exactly, and each structural rule
 * refuses the archive that breaks it. Node's zlib compresses; only the
 * tests use it.
 */
import { deflateRawSync } from "node:zlib";

import { LIMITS } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { crc32 } from "./crc32.js";
import { openZip, ZipError, type ZipErrorCode } from "./zip.js";

interface Part {
  readonly name: string;
  readonly content: Uint8Array;
  readonly method?: 0 | 8;
  /** Write sizes and CRC in a data descriptor after the data. */
  readonly descriptor?: "signed" | "unsigned";
  readonly flags?: number;
  readonly extra?: Uint8Array;
  /** Bytes of the name as written, where the test needs other bytes. */
  readonly rawName?: Uint8Array;
}

interface Options {
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

const encode = (text: string) => new TextEncoder().encode(text);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A ZIP archive laid out as spreadsheet software writes it, unless told otherwise. */
function makeZip(parts: readonly Part[], options: Options = {}): Uint8Array {
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
        ? new Uint8Array(deflateRawSync(part.content))
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

const refusal = (bytes: Uint8Array): ZipErrorCode | "none" => {
  try {
    const archive = openZip(bytes);
    archive.read(archive.entries);
    return "none";
  } catch (error) {
    if (error instanceof ZipError) return error.code;
    throw error;
  }
};

const sheet = encode(`<sheetData>${"<row/>".repeat(500)}</sheetData>`);
const workbook: Part[] = [
  { name: "[Content_Types].xml", content: encode("<Types/>") },
  { name: "xl/workbook.xml", content: encode("<workbook/>") },
  { name: "xl/worksheets/sheet1.xml", content: sheet },
];

describe("openZip: archives written the plain way", () => {
  it("reads every entry back exactly, inflating only when asked", () => {
    const archive = openZip(makeZip(workbook));
    expect(archive.entries.map((e) => e.name)).toEqual([
      "[Content_Types].xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const entry = archive.find("XL/WORKSHEETS/SHEET1.XML");
    if (entry === undefined) throw new Error("not found");
    const [content] = archive.read([entry]);
    expect(Buffer.from(content ?? []).equals(Buffer.from(sheet))).toBe(true);
  });

  it("reads stored entries, data descriptors with and without a signature, and a comment", () => {
    for (const descriptor of ["signed", "unsigned"] as const) {
      expect(
        refusal(
          makeZip(
            [
              { name: "a.xml", content: sheet, method: 0 },
              { name: "b.xml", content: sheet, descriptor },
            ],
            { comment: encode("written by a spreadsheet") },
          ),
        ),
        descriptor,
      ).toBe("none");
    }
  });
});

describe("openZip: one refusal per rule", () => {
  const cases: [string, Uint8Array, ZipErrorCode][] = [
    ["not a ZIP at all", encode("Date,Amount\n2026-01-02,1\n"), "zipEnd"],
    [
      "an end record whose comment overruns the file",
      makeZip(workbook, {
        end: (e) => {
          e.setUint16(20, 5, true);
        },
      }),
      "zipEnd",
    ],
    [
      "a second end record hidden in the comment",
      (() => {
        // A comment ending in a whole end record of its own: both end the
        // file, so the archive could be read two ways.
        const inner = new DataView(new ArrayBuffer(22));
        inner.setUint32(0, 0x06054b50, true);
        return makeZip(workbook, { comment: new Uint8Array(inner.buffer) });
      })(),
      "zipEnd",
    ],
    [
      "bytes before the first entry",
      makeZip(workbook, { prefix: encode("MZ") }),
      "zipLayout",
    ],
    [
      "a gap before the directory",
      makeZip(workbook, { gap: encode("hidden") }),
      "zipLayout",
    ],
    [
      "a second disk",
      makeZip(workbook, {
        end: (e) => {
          e.setUint16(4, 1, true);
        },
      }),
      "zipDisk",
    ],
    [
      "ZIP64 sizes",
      makeZip(workbook, {
        central: (i, c) => {
          if (i === 0) c.setUint32(24, 0xffffffff, true);
        },
      }),
      "zip64",
    ],
    [
      "a ZIP64 extra field",
      makeZip([
        { name: "a.xml", content: sheet, extra: Uint8Array.of(1, 0, 0, 0) },
      ]),
      "zip64",
    ],
    [
      "an encrypted entry",
      makeZip([{ name: "a.xml", content: sheet, flags: 1 }]),
      "zipEncrypted",
    ],
    [
      "a flag this reader does not take",
      makeZip([{ name: "a.xml", content: sheet, flags: 1 << 4 }]),
      "zipFlags",
    ],
    [
      "a method other than stored or DEFLATE",
      makeZip(workbook, {
        central: (i, c) => {
          if (i === 1) c.setUint16(10, 12, true);
        },
      }),
      "zipMethod",
    ],
    [
      "a stored entry with two sizes",
      makeZip([{ name: "a.xml", content: sheet, method: 0 }], {
        central: (_, c) => {
          c.setUint32(20, 3, true);
        },
      }),
      "zipStoredSize",
    ],
    [
      "a backslash in a name",
      makeZip([{ name: "xl\\workbook.xml", content: sheet }]),
      "zipName",
    ],
    [
      "a name climbing out",
      makeZip([{ name: "xl/../../evil.xml", content: sheet }]),
      "zipName",
    ],
    [
      "a name from the root",
      makeZip([{ name: "/xl/workbook.xml", content: sheet }]),
      "zipName",
    ],
    [
      "a name past ASCII",
      makeZip([
        { name: "x", rawName: Uint8Array.of(0x78, 0xc3, 0xa9), content: sheet },
      ]),
      "zipName",
    ],
    [
      "a name of a control character",
      makeZip([
        { name: "x", rawName: Uint8Array.of(0x78, 0x00), content: sheet },
      ]),
      "zipName",
    ],
    [
      "names that differ only in case",
      makeZip([
        { name: "xl/workbook.xml", content: sheet },
        { name: "XL/Workbook.xml", content: sheet },
      ]),
      "zipDuplicate",
    ],
    [
      "a malformed extra field",
      makeZip([
        { name: "a.xml", content: sheet, extra: Uint8Array.of(9, 0, 9, 0) },
      ]),
      "zipExtra",
    ],
    [
      "a local header naming another file",
      makeZip(workbook, {
        local: (i, l) => {
          if (i === 1) l.setUint16(8, 0, true);
        },
      }),
      "zipHeader",
    ],
    [
      "a local header with another CRC",
      makeZip(workbook, {
        local: (i, l) => {
          if (i === 2) l.setUint32(14, 1, true);
        },
      }),
      "zipHeader",
    ],
    [
      "a data descriptor that disagrees",
      makeZip([{ name: "a.xml", content: sheet, descriptor: "signed" }], {
        central: (_, c) => {
          c.setUint32(16, (c.getUint32(16, true) ^ 1) >>> 0, true);
        },
      }),
      "zipDescriptor",
    ],
    [
      "content that is not what its CRC says",
      makeZip([{ name: "a.xml", content: sheet, method: 0 }], {
        central: (_, c) => {
          c.setUint32(16, 7, true);
        },
        local: (_, l) => {
          l.setUint32(14, 7, true);
        },
      }),
      "zipChecksum",
    ],
    [
      "a central directory where the end record does not say",
      makeZip(workbook, {
        end: (e) => {
          e.setUint32(16, e.getUint32(16, true) + 1, true);
        },
      }),
      "zipDirectory",
    ],
  ];
  for (const [name, bytes, code] of cases) {
    it(`refuses ${name}`, () => {
      expect(refusal(bytes)).toBe(code);
    });
  }

  it("refuses a DEFLATE stream the decoder refuses", () => {
    const bytes = makeZip([{ name: "a.xml", content: sheet }]);
    // The first data byte: block type 3, which RFC 1951 reserves.
    const local = 30 + "a.xml".length;
    bytes[local] = 0b111;
    expect(refusal(bytes)).toBe("zipInflate");
  });

  it("counts the entries before it reads the directory", () => {
    const many = Array.from({ length: LIMITS.zipEntries + 1 }, (_, i) => ({
      name: `p${String(i)}.xml`,
      content: encode("<x/>"),
    }));
    expect(refusal(makeZip(many))).toBe("zipEntries");
    expect(refusal(makeZip(many.slice(0, LIMITS.zipEntries)))).toBe("none");
  });

  it("refuses to inflate past its budget, before inflating anything", () => {
    // A part that says it inflates to more than the budget is refused on
    // its word, without a byte decoded.
    const big = makeZip([{ name: "a.xml", content: sheet }], {
      central: (_, c) => {
        c.setUint32(24, LIMITS.inflatedBytes + 1, true);
      },
      local: (_, l) => {
        l.setUint32(22, LIMITS.inflatedBytes + 1, true);
      },
    });
    const archive = openZip(big);
    expect(() => archive.read(archive.entries)).toThrow(
      expect.objectContaining({ code: "zipBudget" }),
    );
  });

  it("stays fast on an archive made of end-record signatures", () => {
    const size = 8 * 1024 * 1024;
    const junk = new Uint8Array(size);
    for (let i = 0; i + 4 <= size; i += 4) {
      junk.set([0x50, 0x4b, 0x05, 0x06], i);
    }
    const started = Date.now();
    expect(refusal(junk)).not.toBe("none");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
