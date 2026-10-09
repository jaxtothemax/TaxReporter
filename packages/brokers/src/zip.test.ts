/**
 * The ZIP reader on archives a small writer here makes: the plain layout
 * spreadsheet software writes reads back exactly, and each structural rule
 * refuses the archive that breaks it. Node's zlib compresses; only the
 * tests use it.
 */
import { LIMITS } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { encode, makeZip, type Part } from "./testing/zip-writer.js";
import { openZip, ZipError, type ZipErrorCode } from "./zip.js";

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

  it("charges every read to one budget, a failed one included", () => {
    // Two parts that each fit the budget, and not together. Each claims to
    // inflate to more than it does, so the first read fails, still charged.
    const half = Math.floor(LIMITS.inflatedBytes / 2) + 1;
    const archive = openZip(
      makeZip([
        { name: "a.xml", content: sheet },
        { name: "b.xml", content: sheet },
      ]),
    );
    const [a, b] = archive.entries;
    if (a === undefined || b === undefined) throw new Error("two entries");
    const claim = (entry: typeof a) => ({ ...entry, size: half });
    expect(() => archive.read([claim(a)])).toThrow(
      expect.objectContaining({ code: "zipInflate" }),
    );
    expect(() => archive.read([claim(b)])).toThrow(
      expect.objectContaining({ code: "zipBudget" }),
    );
  });

  it("refuses a record signature in the archive comment", () => {
    const end = new Uint8Array(22);
    end.set([0x50, 0x4b, 0x05, 0x06]);
    const comment = new Uint8Array([...end, 0x6a, 0x75, 0x6e, 0x6b]);
    expect(
      refusal(makeZip([{ name: "a.xml", content: sheet }], { comment })),
    ).toBe("zipEnd");
    // Text that only mentions PK passes.
    const text = new TextEncoder().encode("PK files");
    expect(
      refusal(makeZip([{ name: "a.xml", content: sheet }], { comment: text })),
    ).toBe("none");
  });

  it("refuses a name spelled two ways, or a second name for it", () => {
    for (const name of ["xl/./a.xml", "xl//a.xml", "xl/sheet%31.xml", "a/"]) {
      const expected = name === "a/" ? "none" : "zipName";
      expect(refusal(makeZip([{ name, content: sheet }])), name).toBe(expected);
    }
    const unicodePath = new Uint8Array([0x75, 0x70, 0x01, 0x00, 0x00]);
    expect(
      refusal(makeZip([{ name: "a.xml", content: sheet, extra: unicodePath }])),
    ).toBe("zipExtra");
  });

  it("refuses a stored entry with a data descriptor, and a DEFLATE entry larger than stored", () => {
    expect(
      refusal(
        makeZip([
          { name: "a.xml", content: sheet, method: 0, descriptor: "signed" },
        ]),
      ),
    ).toBe("zipFlags");
    // "A" after empty stored blocks, 5 bytes each: a valid stream that no
    // encoder writes past stored size plus 5 bytes a block, plus 64.
    const padded = (blocks: number) =>
      makeZip([
        {
          name: "a.xml",
          content: new Uint8Array([0x41]),
          deflated: new Uint8Array([
            ...Array.from({ length: blocks }, () => [
              0, 0, 0, 0xff, 0xff,
            ]).flat(),
            0x01,
            0x01,
            0x00,
            0xfe,
            0xff,
            0x41,
          ]),
        },
      ]);
    // 1 + 5 + 64 = 70 bytes at most: 12 blocks make 66, 13 make 71.
    const fits = openZip(padded(12));
    expect(Array.from(fits.read(fits.entries)[0] ?? [])).toEqual([0x41]);
    expect(refusal(padded(13))).toBe("zipInflate");
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
