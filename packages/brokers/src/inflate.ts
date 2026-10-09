/**
 * DEFLATE decoding (RFC 1951), of our own (ADR 0014), for the parts of an
 * XLSX workbook. Every stream is hostile (CLAUDE.md, "Secure code"), so
 * this decodes what a conforming encoder writes and refuses the rest,
 * never reading on a guess:
 *
 * - the output is exactly the size the archive declares: a byte past it
 *   refuses at once, and so does a stream that ends short of it, so no
 *   stream decompresses beyond its budget ("zip bomb") or truncates
 *   silently;
 * - input is never read past its end, a stored block must carry
 *   LEN = ~NLEN, and block type 3 is refused;
 * - a Huffman code must fit RFC 1951's alphabets (at most 286 length and 30
 *   distance codes), have an end-of-block code, and be complete: only a
 *   lone one-bit code may be incomplete, as zlib allows; a repeat may not
 *   open a code-length list or run past its end; length symbols 286–287
 *   and distance symbols 30–31 are refused;
 * - a distance may not reach before the start of the output, and nothing
 *   but the final byte's padding may follow the final block.
 *
 * Canonical decoding as in Mark Adler's puff.c: tables of counts and
 * symbols, bits taken one at a time from a buffer, no recursion and no
 * table that can grow with the input; time is linear in input and output.
 * Errors name a rule, never a byte of the stream.
 */

export type InflateErrorCode =
  /** The stream ends before its final block does. */
  | "truncated"
  /** A stored block's length disagrees with its complement. */
  | "storedLength"
  /** Block type 3, which RFC 1951 reserves. */
  | "blockType"
  /** Code lengths that make no valid Huffman code, or run past their list. */
  | "codeLengths"
  /** A code no symbol has, or a symbol RFC 1951 reserves. */
  | "symbol"
  /** A distance reaching before the start of the output. */
  | "distance"
  /** Output beyond, or short of, the size the archive declares. */
  | "size"
  /** Bytes after the final block. */
  | "trailing";

export class InflateError extends Error {
  constructor(readonly code: InflateErrorCode) {
    super(`DEFLATE stream refused (${code})`);
  }
}

const MAXBITS = 15;
const MAXLCODES = 286;
const MAXDCODES = 30;
const FIXLCODES = 288;
const END_OF_BLOCK = 256;

/** Length symbols 257–285: base lengths and extra bits (RFC 1951 §3.2.5). */
const LBASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LEXT = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
/** Distance symbols 0–29: base distances and extra bits. */
const DBASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DEXT = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];
/** The order code-length code lengths are sent in (RFC 1951 §3.2.7). */
const ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/** A canonical Huffman code: how many codes of each length, then symbols. */
interface Huffman {
  readonly count: Uint16Array;
  readonly symbol: Uint16Array;
}

const huffman = (symbols: number): Huffman => ({
  count: new Uint16Array(MAXBITS + 1),
  symbol: new Uint16Array(symbols),
});

/**
 * Fills `h` from the code lengths, as puff's `construct`: 0 for a complete
 * code, more than 0 for an incomplete one, less than 0 for one with more
 * codes than its lengths allow (over-subscribed).
 */
function construct(h: Huffman, lengths: Uint8Array, n: number): number {
  h.count.fill(0);
  for (let symbol = 0; symbol < n; symbol += 1) {
    h.count[lengths[symbol] as number] =
      (h.count[lengths[symbol] as number] as number) + 1;
  }
  if (h.count[0] === n) return 0;
  let left = 1;
  for (let len = 1; len <= MAXBITS; len += 1) {
    left = left * 2 - (h.count[len] as number);
    if (left < 0) return left;
  }
  const offs = new Uint16Array(MAXBITS + 1);
  for (let len = 1; len < MAXBITS; len += 1) {
    offs[len + 1] = (offs[len] as number) + (h.count[len] as number);
  }
  for (let symbol = 0; symbol < n; symbol += 1) {
    const len = lengths[symbol] as number;
    if (len !== 0) {
      const at = offs[len] as number;
      h.symbol[at] = symbol;
      offs[len] = at + 1;
    }
  }
  return left;
}

/** Whether an incomplete code is the one zlib allows: a lone one-bit code. */
const isLoneOneBit = (h: Huffman, n: number): boolean =>
  (h.count[0] as number) + (h.count[1] as number) === n;

class Stream {
  pos = 0;
  bitbuf = 0;
  bitcnt = 0;
  outpos = 0;

  constructor(
    readonly input: Uint8Array,
    readonly out: Uint8Array,
  ) {}

  /** `need` bits, at most 13, least significant first; never past the input. */
  bits(need: number): number {
    let val = this.bitbuf;
    while (this.bitcnt < need) {
      if (this.pos >= this.input.length) throw new InflateError("truncated");
      val |= (this.input[this.pos] as number) << this.bitcnt;
      this.pos += 1;
      this.bitcnt += 8;
    }
    this.bitbuf = val >>> need;
    this.bitcnt -= need;
    return val & ((1 << need) - 1);
  }

  /** One symbol of `h`, a bit at a time (puff's faster `decode`). */
  decode(h: Huffman): number {
    let bitbuf = this.bitbuf;
    let left = this.bitcnt;
    let code = 0;
    let first = 0;
    let index = 0;
    let len = 1;
    for (;;) {
      while (left > 0) {
        left -= 1;
        code |= bitbuf & 1;
        bitbuf >>>= 1;
        const count = h.count[len] as number;
        if (code - count < first) {
          this.bitbuf = bitbuf;
          this.bitcnt = (this.bitcnt - len) & 7;
          return h.symbol[index + (code - first)] as number;
        }
        index += count;
        first = (first + count) * 2;
        code *= 2;
        len += 1;
      }
      left = MAXBITS + 1 - len;
      if (left === 0) break;
      if (this.pos >= this.input.length) throw new InflateError("truncated");
      bitbuf = this.input[this.pos] as number;
      this.pos += 1;
      if (left > 8) left = 8;
    }
    // A bit pattern no symbol has: only an incomplete code leaves one.
    throw new InflateError("symbol");
  }

  /** A stored block: the rest of this byte skipped, LEN bytes copied. */
  stored(): void {
    this.bitbuf = 0;
    this.bitcnt = 0;
    if (this.pos + 4 > this.input.length) throw new InflateError("truncated");
    const at = this.pos;
    const len =
      (this.input[at] as number) | ((this.input[at + 1] as number) << 8);
    const nlen =
      (this.input[at + 2] as number) | ((this.input[at + 3] as number) << 8);
    if (len !== (~nlen & 0xffff)) throw new InflateError("storedLength");
    this.pos = at + 4;
    if (this.pos + len > this.input.length) {
      throw new InflateError("truncated");
    }
    if (this.outpos + len > this.out.length) throw new InflateError("size");
    this.out.set(this.input.subarray(this.pos, this.pos + len), this.outpos);
    this.pos += len;
    this.outpos += len;
  }

  /** Literals and copies until the end-of-block symbol. */
  codes(lencode: Huffman, distcode: Huffman): void {
    const { out } = this;
    for (;;) {
      let symbol = this.decode(lencode);
      if (symbol < 256) {
        if (this.outpos >= out.length) throw new InflateError("size");
        out[this.outpos] = symbol;
        this.outpos += 1;
        continue;
      }
      if (symbol === END_OF_BLOCK) return;
      symbol -= 257;
      // 286 and 287 exist only in the fixed code, and mean nothing.
      if (symbol >= 29) throw new InflateError("symbol");
      const len = (LBASE[symbol] as number) + this.bits(LEXT[symbol] as number);
      const dsym = this.decode(distcode);
      if (dsym >= MAXDCODES) throw new InflateError("symbol");
      const dist = (DBASE[dsym] as number) + this.bits(DEXT[dsym] as number);
      if (dist > this.outpos) throw new InflateError("distance");
      if (this.outpos + len > out.length) throw new InflateError("size");
      // Byte by byte: a copy may overlap what it is producing (RLE).
      for (let n = 0; n < len; n += 1) {
        out[this.outpos] = out[this.outpos - dist] as number;
        this.outpos += 1;
      }
    }
  }

  /** A block with its own codes, sent as code lengths (RFC 1951 §3.2.7). */
  dynamic(lencode: Huffman, distcode: Huffman, lengths: Uint8Array): void {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;
    if (nlen > MAXLCODES || ndist > MAXDCODES) {
      throw new InflateError("codeLengths");
    }
    lengths.fill(0);
    for (let i = 0; i < ncode; i += 1) {
      lengths[ORDER[i] as number] = this.bits(3);
    }
    // The code-length code must be complete: no lone-code exception.
    if (construct(lencode, lengths, 19) !== 0) {
      throw new InflateError("codeLengths");
    }
    let index = 0;
    while (index < nlen + ndist) {
      let symbol = this.decode(lencode);
      if (symbol < 16) {
        lengths[index] = symbol;
        index += 1;
        continue;
      }
      let len = 0;
      if (symbol === 16) {
        // A repeat of the previous length, which the first has none of.
        if (index === 0) throw new InflateError("codeLengths");
        len = lengths[index - 1] as number;
        symbol = 3 + this.bits(2);
      } else if (symbol === 17) {
        symbol = 3 + this.bits(3);
      } else {
        symbol = 11 + this.bits(7);
      }
      if (index + symbol > nlen + ndist) {
        throw new InflateError("codeLengths");
      }
      lengths.fill(len, index, index + symbol);
      index += symbol;
    }
    if (lengths[END_OF_BLOCK] === 0) throw new InflateError("codeLengths");
    const lerr = construct(lencode, lengths, nlen);
    if (lerr < 0 || (lerr > 0 && !isLoneOneBit(lencode, nlen))) {
      throw new InflateError("codeLengths");
    }
    const dlengths = lengths.subarray(nlen, nlen + ndist);
    const derr = construct(distcode, dlengths, ndist);
    if (derr < 0 || (derr > 0 && !isLoneOneBit(distcode, ndist))) {
      throw new InflateError("codeLengths");
    }
    this.codes(lencode, distcode);
  }
}

/** The fixed codes of RFC 1951 §3.2.6, built once. */
const FIXED = (() => {
  const lengths = new Uint8Array(FIXLCODES);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  const lencode = huffman(FIXLCODES);
  construct(lencode, lengths, FIXLCODES);
  const dlengths = new Uint8Array(MAXDCODES).fill(5);
  const distcode = huffman(MAXDCODES);
  construct(distcode, dlengths, MAXDCODES);
  return { lencode, distcode };
})();

/**
 * Decodes a raw DEFLATE stream that must produce exactly `size` bytes and
 * use every byte of `input`. Throws `InflateError` otherwise.
 */
export function inflate(input: Uint8Array, size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("A size is a whole number of bytes");
  }
  const stream = new Stream(input, new Uint8Array(size));
  const lencode = huffman(MAXLCODES);
  const distcode = huffman(MAXDCODES);
  const lengths = new Uint8Array(MAXLCODES + MAXDCODES);
  for (;;) {
    const last = stream.bits(1);
    const type = stream.bits(2);
    if (type === 0) stream.stored();
    else if (type === 1) stream.codes(FIXED.lencode, FIXED.distcode);
    else if (type === 2) stream.dynamic(lencode, distcode, lengths);
    else throw new InflateError("blockType");
    if (last === 1) break;
  }
  // The final byte's unused bits are padding; a whole byte more is not.
  // Stricter than Node's zlib, which stops at the final block and ignores
  // what follows: a ZIP entry holds its stream and nothing else.
  if (stream.pos !== input.length) throw new InflateError("trailing");
  if (stream.outpos !== size) throw new InflateError("size");
  return stream.out;
}
