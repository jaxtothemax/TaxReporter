/**
 * The DEFLATE decoder against Node's zlib, which only the tests use: every
 * stream zlib writes decodes to exactly its input, and every stream the
 * decoder accepts, zlib accepts and decodes alike. Then the refusals, one
 * per rule, and the bounds that keep a hostile stream cheap.
 */
import {
  constants,
  deflateRawSync,
  inflateRawSync,
  type ZlibOptions,
} from "node:zlib";

import { describe, expect, it } from "vitest";

import { crc32 } from "./crc32.js";
import { inflate, InflateError, type InflateErrorCode } from "./inflate.js";

/** A deterministic stream of pseudo-random bytes (xorshift32). */
function noise(length: number, seed: number, alphabet = 256): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = (x >>> 0) % alphabet;
  }
  return out;
}

/** Text that compresses as a sheet does: repeated tags, varied numbers. */
function sheetLike(rows: number): Uint8Array {
  const parts: string[] = [];
  for (let r = 1; r <= rows; r += 1) {
    parts.push(
      `<row r="${String(r)}"><c r="A${String(r)}" t="s"><v>${String(r % 97)}</v></c><c r="B${String(r)}"><v>${String((r * 7919) % 100003)}.${String(r % 100)}</v></c></row>`,
    );
  }
  return new TextEncoder().encode(parts.join(""));
}

const refusal = (
  input: Uint8Array,
  size: number,
): InflateErrorCode | "none" => {
  try {
    inflate(input, size);
    return "none";
  } catch (error) {
    if (error instanceof InflateError) return error.code;
    throw error;
  }
};

/** Bits written least significant first, as DEFLATE packs them. */
class BitWriter {
  private readonly bytes: number[] = [];
  private acc = 0;
  private n = 0;
  write(value: number, count: number): this {
    for (let i = 0; i < count; i += 1) {
      this.acc |= ((value >>> i) & 1) << this.n;
      this.n += 1;
      if (this.n === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
    return this;
  }
  /** A Huffman code is sent most significant bit first. */
  code(value: number, length: number): this {
    for (let i = length - 1; i >= 0; i -= 1) this.write((value >>> i) & 1, 1);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(
      this.n === 0 ? this.bytes : [...this.bytes, this.acc],
    );
  }
}

/** A fixed-code literal: 0–143 are 8-bit codes from 0x30. */
const literal = (w: BitWriter, byte: number) => w.code(0x30 + byte, 8);
/** The fixed end-of-block code: 256 is the 7-bit code 0. */
const endOfBlock = (w: BitWriter) => w.code(0, 7);

describe("inflate: zlib's streams", () => {
  const inputs: [string, Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["one byte", Uint8Array.of(65)],
    ["noise", noise(100_000, 7)],
    ["skewed noise", noise(100_000, 11, 7)],
    ["a run", new Uint8Array(70_000).fill(0x41)],
    ["a sheet", sheetLike(5000)],
  ];
  const options: [string, ZlibOptions][] = [
    ["stored", { level: 0 }],
    ["fast", { level: 1 }],
    ["default", {}],
    ["best", { level: 9 }],
    ["Huffman only", { strategy: constants.Z_HUFFMAN_ONLY }],
    ["RLE", { strategy: constants.Z_RLE }],
    ["fixed codes", { strategy: constants.Z_FIXED }],
    ["small window", { windowBits: 9, level: 9 }],
  ];

  for (const [name, data] of inputs) {
    for (const [how, option] of options) {
      it(`decodes ${name}, ${how}, to exactly its input`, () => {
        const deflated = deflateRawSync(data, option);
        const out = inflate(deflated, data.length);
        expect(out.length).toBe(data.length);
        expect(crc32(out)).toBe(crc32(data));
        expect(Buffer.from(out).equals(Buffer.from(data))).toBe(true);
      });
    }
  }
});

describe("inflate: damaged streams", () => {
  it("accepts nothing zlib refuses, and decodes nothing differently", () => {
    const data = sheetLike(300);
    const clean = deflateRawSync(data);
    let refused = 0;
    for (let trial = 0; trial < 3000; trial += 1) {
      const damaged = Uint8Array.from(clean);
      const at = (trial * 7919) % damaged.length;
      damaged[at] = (damaged[at] as number) ^ (1 << (trial % 8));
      let expected: Buffer | null;
      try {
        expected = inflateRawSync(damaged);
      } catch {
        expected = null;
      }
      const ours = refusal(damaged, expected?.length ?? data.length);
      if (ours !== "none") {
        refused += 1;
        continue;
      }
      // Accepted: zlib must have accepted it too, with the same bytes.
      expect(expected, `trial ${String(trial)}`).not.toBeNull();
      const out = inflate(damaged, expected?.length ?? 0);
      expect(Buffer.from(out).equals(expected ?? Buffer.alloc(0))).toBe(true);
    }
    expect(refused).toBeGreaterThan(0);
  });

  it("refuses a stream cut short anywhere", () => {
    const data = sheetLike(200);
    const deflated = deflateRawSync(data);
    for (let end = 0; end < deflated.length; end += 1) {
      expect(
        refusal(deflated.subarray(0, end), data.length),
        `cut at ${String(end)}`,
      ).not.toBe("none");
    }
  });
});

describe("inflate: one refusal per rule", () => {
  it("refuses output past the declared size, at once, and short of it", () => {
    const data = sheetLike(100);
    const deflated = deflateRawSync(data);
    expect(refusal(deflated, data.length - 1)).toBe("size");
    expect(refusal(deflated, data.length + 1)).toBe("size");
    expect(refusal(deflated, 0)).toBe("size");
  });

  it("refuses a stored block whose length disagrees with its complement", () => {
    // Final stored block: header bits 1, 00, then LEN 3, NLEN not ~3.
    const block = Uint8Array.of(0x01, 0x03, 0x00, 0xfc, 0xfe, 65, 66, 67);
    expect(refusal(block, 3)).toBe("storedLength");
    const good = Uint8Array.of(0x01, 0x03, 0x00, 0xfc, 0xff, 65, 66, 67);
    expect(Array.from(inflate(good, 3))).toEqual([65, 66, 67]);
  });

  it("refuses block type 3", () => {
    expect(refusal(new BitWriter().write(1, 1).write(3, 2).done(), 0)).toBe(
      "blockType",
    );
  });

  it("refuses the reserved length symbols 286 and 287", () => {
    // Fixed codes: 280–287 are 8-bit codes from 0xC0.
    for (const symbol of [286, 287]) {
      const w = new BitWriter().write(1, 1).write(1, 2);
      literal(w, 65);
      w.code(0xc0 + (symbol - 280), 8);
      expect(refusal(w.done(), 10), String(symbol)).toBe("symbol");
    }
  });

  it("refuses the reserved distance symbols 30 and 31", () => {
    for (const dist of [30, 31]) {
      const w = new BitWriter().write(1, 1).write(1, 2);
      literal(w, 65);
      // Length 3 is symbol 257, the 7-bit code 1; then a 5-bit distance.
      // The fixed distance code leaves 30 and 31 unused, and the decoder
      // reads on to 15 bits before it can say so: pad the stream that far.
      w.code(1, 7).code(dist, 5).write(0, 16);
      expect(refusal(w.done(), 4), String(dist)).toBe("symbol");
    }
  });

  it("refuses a distance reaching before the start of the output", () => {
    const w = new BitWriter().write(1, 1).write(1, 2);
    literal(w, 65);
    // Length 3, distance symbol 1 (distance 2): one byte written so far.
    w.code(1, 7).code(1, 5);
    endOfBlock(w);
    expect(refusal(w.done(), 4)).toBe("distance");
  });

  it("refuses bytes after the final block", () => {
    const w = new BitWriter().write(1, 1).write(1, 2);
    literal(w, 65);
    endOfBlock(w);
    const stream = w.done();
    expect(Array.from(inflate(stream, 1))).toEqual([65]);
    expect(refusal(Uint8Array.from([...stream, 0]), 1)).toBe("trailing");
  });

  /** A dynamic block header with the given code-length code lengths. */
  function dynamicHeader(
    nlen: number,
    ndist: number,
    codeLengths: readonly number[],
  ): BitWriter {
    const w = new BitWriter().write(1, 1).write(2, 2);
    w.write(nlen - 257, 5)
      .write(ndist - 1, 5)
      .write(codeLengths.length - 4, 4);
    for (const length of codeLengths) w.write(length, 3);
    return w;
  }

  it("refuses more length or distance codes than RFC 1951 has", () => {
    expect(refusal(dynamicHeader(287, 1, [0, 0, 0, 1]).done(), 0)).toBe(
      "codeLengths",
    );
    expect(refusal(dynamicHeader(257, 31, [0, 0, 0, 1]).done(), 0)).toBe(
      "codeLengths",
    );
  });

  it("refuses an incomplete or over-subscribed code-length code", () => {
    // One code of length 1 is incomplete; three of length 1 too many.
    expect(refusal(dynamicHeader(257, 1, [0, 0, 0, 1]).done(), 0)).toBe(
      "codeLengths",
    );
    expect(refusal(dynamicHeader(257, 1, [1, 1, 1, 0]).done(), 0)).toBe(
      "codeLengths",
    );
  });

  it("refuses a repeat with nothing before it, or past the list's end", () => {
    // Order: 16, 17, 18, 0 get lengths 1, 0, 1, 0... keep it complete:
    // symbol 16 and symbol 18 at length 1 make a complete two-code code.
    const first = dynamicHeader(257, 1, [1, 0, 1, 0]);
    // 16 is the code 0 (the lower symbol), sent first: nothing to repeat.
    first.code(0, 1).write(0, 2);
    expect(refusal(first.done(), 0)).toBe("codeLengths");
    // 18 repeats zero 11 + 127 = 138 times, twice: past 257 + 1 = 258.
    const past = dynamicHeader(257, 1, [1, 0, 1, 0]);
    past.code(1, 1).write(127, 7).code(1, 1).write(127, 7);
    expect(refusal(past.done(), 0)).toBe("codeLengths");
  });

  it("refuses a code without an end-of-block symbol", () => {
    // Code-length code: 17 (repeat zero, 3+7) and 18 (repeat zero, 11+127)
    // complete at length 1; all 258 lengths zero, so 256 has no code.
    const w = dynamicHeader(257, 1, [0, 1, 1, 0]);
    w.code(1, 1).write(127, 7).code(1, 1).write(127, 7);
    // 138 + 138 = 276 > 258: use 18 then 17s instead.
    const fit = dynamicHeader(257, 1, [0, 1, 1, 0]);
    fit.code(1, 1).write(127, 7); // 138
    fit.code(1, 1).write(109, 7); // 120, 258 in all
    expect(refusal(fit.done(), 0)).toBe("codeLengths");
    expect(refusal(w.done(), 0)).toBe("codeLengths");
  });

  it("keeps a run made to be large inside its budget", () => {
    // One literal, then copies of length 258 at distance 1: a bomb that
    // would decode to far more than declared stops at the declared size.
    const w = new BitWriter().write(1, 1).write(1, 2);
    literal(w, 0x41);
    for (let i = 0; i < 40_000; i += 1) {
      // Length 258 is symbol 285, the 8-bit code 0xC5; distance 1, code 0.
      w.code(0xc5, 8).code(0, 5);
    }
    endOfBlock(w);
    const bomb = w.done();
    expect(refusal(bomb, 1000)).toBe("size");
    expect(inflate(bomb, 1 + 40_000 * 258).length).toBe(1 + 40_000 * 258);
  });

  it("decodes a worst case at a large size in seconds", () => {
    // Literals only, nine-bit fixed codes: the most work per output byte.
    const size = 8 * 1024 * 1024;
    const data = noise(size, 3);
    const deflated = deflateRawSync(data, {
      strategy: constants.Z_HUFFMAN_ONLY,
    });
    const started = Date.now();
    expect(inflate(deflated, size).length).toBe(size);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("crc32", () => {
  it("matches the known values", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(
      crc32(
        new TextEncoder().encode("The quick brown fox jumps over the lazy dog"),
      ),
    ).toBe(0x414fa339);
  });
});
