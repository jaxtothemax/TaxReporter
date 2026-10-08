/**
 * A strict scanner for the XML broker exports are written in. Every imported
 * file is hostile (CLAUDE.md, "Secure code"), so this reads only what an
 * export needs and refuses the rest of XML rather than resolve it:
 *
 * - elements with attributes, nested within LIMITS.xmlDepth, and nothing
 *   else: no text content, no CDATA, no namespaces or prefixes;
 * - no DOCTYPE, so no DTD, no entities beyond XML's five, nothing external
 *   and nothing that expands (XXE, "billion laughs");
 * - an optional `<?xml …?>` declaration at the very start, in UTF-8, and no
 *   other processing instruction; comments are skipped;
 * - every character, written or from a reference, one XML allows: `&#0;`
 *   cannot smuggle in the NUL the intake refuses as a byte.
 *
 * One pass over the text by index, without regular expressions over the rest
 * of it and without recursion, so any input costs time linear in its length.
 * The first error stops the scan; an error names a rule and a line, never a
 * value from the file.
 */
import { LIMITS, type XmlReason } from "@taxreporter/core";

/** The codes are core's, so a diagnostic can only carry one of them. */
export type XmlErrorCode = XmlReason;

export class XmlError extends Error {
  constructor(
    readonly code: XmlErrorCode,
    /** 1-based line of the text where the scan stopped. */
    readonly line: number,
  ) {
    super(`XML refused (${code}) at line ${String(line)}`);
  }
}

/** One element as it opens: its name, its attributes, how deep it sits. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** 1 for the root. */
  readonly depth: number;
  /** 1-based line its start tag begins on. */
  readonly line: number;
}

export interface XmlVisitor {
  open(element: XmlElement): void;
  /** After an element's children; at once for `<Empty/>`. */
  close(name: string, depth: number): void;
}

/** Elements one file may hold: every record and the containers around them. */
export const MAX_XML_ELEMENTS = LIMITS.recordsPerFile + 10_000;

/** Element and attribute names: plain ASCII, as every broker writes them. */
const MAX_NAME_LENGTH = 64;
/** "&#x10FFFF;" has six digits; anything near nine is no character. */
const MAX_REFERENCE_DIGITS = 8;

const LT = 0x3c; // <
const GT = 0x3e; // >
const SLASH = 0x2f;
const EQUALS = 0x3d;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const AMPERSAND = 0x26;
const BANG = 0x21;
const QUESTION = 0x3f;
const HASH = 0x23;
const SEMICOLON = 0x3b;
const NEWLINE = 0x0a;

const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

const isSpace = (c: number) =>
  c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

const isNameStart = (c: number) =>
  (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;

const isNameChar = (c: number) =>
  isNameStart(c) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e;

/** XML 1.0's Char production, by code point. */
function isXmlChar(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** Ends a scan early, once the element wanted has been seen. */
class Found extends Error {}

/**
 * The root element alone, without scanning the rest: what picks the
 * adapter. Whatever comes before it is checked as a full scan checks it.
 */
export function peekRoot(text: string): XmlElement {
  let root: XmlElement | undefined;
  try {
    scanXml(text, {
      open: (element) => {
        root = element;
        throw new Found();
      },
      close: () => undefined,
    });
  } catch (error) {
    if (!(error instanceof Found)) throw error;
  }
  // A scan that ends without an element has already thrown "noRoot".
  return root as XmlElement;
}

/**
 * Scans `text`, a whole decoded export, calling `visitor` for each element
 * as its tag is read. Throws XmlError at the first thing it refuses; a
 * caller keeps nothing it was given before the scan returns.
 */
export function scanXml(text: string, visitor: XmlVisitor): void {
  const length = text.length;
  let i = 0;
  let line = 1;
  let elements = 0;
  const open: string[] = [];
  // One object, as the nested readers set these: a plain `let` would be
  // narrowed to its first value where the loop reads it.
  const root = { seen: false, closed: false };

  const fail = (code: XmlErrorCode): never => {
    throw new XmlError(code, line);
  };

  /** The code point at `i`, checked to be one XML allows; advances `i`. */
  const nextChar = (): number => {
    const code = text.codePointAt(i);
    if (code === undefined) return fail("truncated");
    if (!isXmlChar(code)) fail("illegalCharacter");
    if (code === NEWLINE) line += 1;
    i += code > 0xffff ? 2 : 1;
    return code;
  };

  const skipSpace = () => {
    while (i < length && isSpace(text.charCodeAt(i))) {
      if (text.charCodeAt(i) === NEWLINE) line += 1;
      i += 1;
    }
  };

  const readName = (): string => {
    const start = i;
    if (i >= length) fail("truncated");
    if (!isNameStart(text.charCodeAt(i))) fail("name");
    i += 1;
    while (i < length && isNameChar(text.charCodeAt(i))) i += 1;
    if (i - start > MAX_NAME_LENGTH) fail("name");
    // A colon here would be a namespace prefix, which no export needs.
    if (i < length && text.charCodeAt(i) === 0x3a) fail("name");
    return text.slice(start, i);
  };

  /** A `&…;` reference at `i` (just past the `&`), decoded. */
  const readReference = (): string => {
    if (i < length && text.charCodeAt(i) === HASH) {
      i += 1;
      const hex = i < length && (text.charCodeAt(i) | 0x20) === 0x78;
      if (hex) i += 1;
      const start = i;
      while (i < length && text.charCodeAt(i) !== SEMICOLON) {
        if (i - start >= MAX_REFERENCE_DIGITS) fail("characterReference");
        const c = text.charCodeAt(i);
        const digit =
          (c >= 0x30 && c <= 0x39) ||
          (hex && ((c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)));
        if (!digit) fail("characterReference");
        i += 1;
      }
      if (i >= length) fail("truncated");
      if (i === start) fail("characterReference");
      const code = Number.parseInt(text.slice(start, i), hex ? 16 : 10);
      i += 1; // ;
      if (!isXmlChar(code)) fail("characterReference");
      return String.fromCodePoint(code);
    }
    const start = i;
    while (i < length && text.charCodeAt(i) !== SEMICOLON) {
      if (i - start > 4) fail("entity");
      i += 1;
    }
    if (i >= length) fail("truncated");
    const decoded = PREDEFINED.get(text.slice(start, i));
    if (decoded === undefined) fail("entity");
    i += 1; // ;
    return decoded as string;
  };

  /** A quoted attribute value at `i`, its references decoded. */
  const readValue = (): string => {
    const quote = text.charCodeAt(i);
    if (quote !== QUOTE && quote !== APOSTROPHE) fail("attributeSyntax");
    i += 1;
    const parts: string[] = [];
    let start = i;
    let size = 0;
    for (;;) {
      if (i >= length) fail("truncated");
      const c = text.charCodeAt(i);
      if (c === quote) break;
      if (c === LT) fail("lessThanInValue");
      if (c === AMPERSAND) {
        parts.push(text.slice(start, i));
        i += 1;
        parts.push(readReference());
        size += 1;
        start = i;
      } else {
        nextChar();
        size += 1;
      }
      if (size > LIMITS.cellLength) fail("valueTooLong");
    }
    parts.push(text.slice(start, i));
    i += 1; // closing quote
    return parts.join("");
  };

  /** `<!-- … -->` at `i` (just past `<!--`), skipped. */
  const skipComment = () => {
    for (;;) {
      if (i + 1 >= length) fail("truncated");
      if (text.charCodeAt(i) === 0x2d && text.charCodeAt(i + 1) === 0x2d) {
        // "--" may only end a comment.
        if (i + 2 >= length) fail("truncated");
        if (text.charCodeAt(i + 2) !== GT) fail("comment");
        i += 3;
        return;
      }
      nextChar();
    }
  };

  /** The `<?xml …?>` declaration at offset 0, in UTF-8 if it says. */
  const readDeclaration = () => {
    i = 5; // "<?xml"
    if (i >= length || !isSpace(text.charCodeAt(i))) fail("declaration");
    const seen = new Set<string>();
    for (;;) {
      skipSpace();
      if (i + 1 < length && text.charCodeAt(i) === QUESTION) {
        if (text.charCodeAt(i + 1) !== GT) fail("declaration");
        i += 2;
        break;
      }
      const name = readName();
      if (seen.has(name)) fail("declaration");
      seen.add(name);
      skipSpace();
      if (text.charCodeAt(i) !== EQUALS) fail("declaration");
      i += 1;
      skipSpace();
      const value = readValue();
      const ok =
        (name === "version" && value === "1.0") ||
        (name === "encoding" && value.toUpperCase() === "UTF-8") ||
        (name === "standalone" && (value === "yes" || value === "no"));
      if (!ok) fail("declaration");
    }
    if (!seen.has("version")) fail("declaration");
  };

  /** A start tag at `i` (just past `<`): its element opens, maybe closes. */
  const readStartTag = () => {
    if (root.closed) fail("afterRoot");
    const tagLine = line;
    const name = readName();
    const attributes = new Map<string, string>();
    for (;;) {
      const before = i;
      skipSpace();
      if (i >= length) fail("truncated");
      const c = text.charCodeAt(i);
      if (c === GT || c === SLASH) break;
      // Attributes are separated by whitespace.
      if (i === before) fail("attributeSyntax");
      const key = readName();
      if (attributes.has(key)) fail("duplicateAttribute");
      if (attributes.size >= LIMITS.xmlAttributes) fail("tooManyAttributes");
      if (key === "xmlns" || key.startsWith("xmlns")) fail("name");
      skipSpace();
      if (text.charCodeAt(i) !== EQUALS) fail("attributeSyntax");
      i += 1;
      skipSpace();
      attributes.set(key, readValue());
    }
    const empty = text.charCodeAt(i) === SLASH;
    if (empty) {
      i += 1;
      if (i >= length) fail("truncated");
      if (text.charCodeAt(i) !== GT) fail("attributeSyntax");
    }
    i += 1; // >
    elements += 1;
    if (elements > MAX_XML_ELEMENTS) fail("tooManyElements");
    if (open.length >= LIMITS.xmlDepth) fail("tooDeep");
    root.seen = true;
    const depth = open.length + 1;
    visitor.open({ name, attributes, depth, line: tagLine });
    if (empty) {
      visitor.close(name, depth);
      if (depth === 1) root.closed = true;
    } else {
      open.push(name);
    }
  };

  const readEndTag = () => {
    const name = readName();
    skipSpace();
    if (i >= length) fail("truncated");
    if (text.charCodeAt(i) !== GT) fail("attributeSyntax");
    i += 1;
    const expected = open.pop();
    if (expected !== name) fail("mismatchedEnd");
    visitor.close(name, open.length + 1);
    if (open.length === 0) root.closed = true;
  };

  if (text.startsWith("<?xml") && length > 5 && isSpace(text.charCodeAt(5))) {
    readDeclaration();
  }

  while (i < length) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) {
      skipSpace();
      continue;
    }
    if (c !== LT) {
      // Text between tags: no export carries data there, and a stray
      // byte-order mark or character is refused like any other text.
      nextChar();
      fail("text");
    }
    i += 1;
    if (i >= length) fail("truncated");
    const next = text.charCodeAt(i);
    if (next === SLASH) {
      i += 1;
      readEndTag();
    } else if (next === BANG) {
      if (text.startsWith("--", i + 1)) {
        i += 3;
        skipComment();
      } else if (text.startsWith("[CDATA[", i + 1)) {
        fail("cdata");
      } else {
        fail("doctype");
      }
    } else if (next === QUESTION) {
      fail("processingInstruction");
    } else {
      readStartTag();
    }
  }
  if (!root.seen) fail("noRoot");
  if (open.length > 0) fail("truncated");
}
