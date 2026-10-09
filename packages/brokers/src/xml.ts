/**
 * A strict scanner for the XML broker exports are written in. Every imported
 * file is hostile (CLAUDE.md, "Secure code"), so this reads only what an
 * export needs and refuses the rest of XML rather than resolve it.
 *
 * Two profiles. The plain one, for exports like Interactive Brokers':
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
 * The OOXML profile, for the parts of an XLSX workbook (ADR 0014 §4), takes
 * what Office Open XML needs on top, read as a conforming XML processor
 * reads it:
 *
 * - namespace declarations, checked as Namespaces in XML 1.0 requires and
 *   resolved within LIMITS.xmlDepth frames: an element is named by its
 *   namespace URI and local name, a prefixed attribute by `{uri}local`, and
 *   duplicates are found after resolution;
 * - text content, passed to the visitor whole, leading spaces and all, with
 *   line ends normalized (XML 1.0 §2.11), at most LIMITS.xlsxCellLength
 *   characters in a piece; `]]>` in it is refused, as XML refuses it;
 * - attribute values normalized as XML 1.0 §3.3.3 normalizes them;
 * - one budget of elements for every part of the file, not each scan alone.
 *
 * DOCTYPE, CDATA, processing instructions and entities beyond XML's five
 * stay refused in both.
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
  /** As written: `c`, or with its prefix, `x:c`. */
  readonly name: string;
  /** The namespace URI it is in, "" for none (always "" in the plain profile). */
  readonly namespace: string;
  /** Its name without a prefix. */
  readonly local: string;
  /**
   * By name; in the OOXML profile, a prefixed attribute by `{uri}local`, and
   * namespace declarations are not among them.
   */
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
  /**
   * Text inside an element, references decoded, in one or more pieces (a
   * comment splits it). Only the OOXML profile has text; without this, any
   * but white space is refused.
   */
  text?(value: string, depth: number): void;
}

/** What a scan may take besides the plain profile. */
export interface ScanOptions {
  /** Namespaces and text, as an XLSX workbook's parts are written. */
  readonly ooxml?: boolean;
  /**
   * Elements the scan may still read, shared by every scan of one file and
   * counted down as it reads; MAX_XML_ELEMENTS for a scan of its own.
   */
  readonly budget?: { elements: number };
}

/** The `xml` prefix's namespace, bound without a declaration. */
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
/** The `xmlns` prefix's, which no declaration may name. */
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** The frame of an element that declares nothing, shared by them all. */
const NO_DECLARATIONS: ReadonlyMap<string, string> = new Map();

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
const COLON = 0x3a;
const TAB = 0x09;
const NEWLINE = 0x0a;
const RETURN = 0x0d;

const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

const isSpace = (c: number) =>
  c === 0x20 || c === TAB || c === NEWLINE || c === RETURN;

/** Whether text is XML white space alone (no-break spaces are text). */
function isBlank(value: string): boolean {
  for (let k = 0; k < value.length; k += 1) {
    if (!isSpace(value.charCodeAt(k))) return false;
  }
  return true;
}

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
export function scanXml(
  text: string,
  visitor: XmlVisitor,
  options: ScanOptions = {},
): void {
  const length = text.length;
  const ooxml = options.ooxml === true;
  const budget = options.budget ?? { elements: MAX_XML_ELEMENTS };
  let i = 0;
  let line = 1;
  const open: string[] = [];
  /** Namespace declarations, one frame per open element (OOXML only). */
  const scopes: ReadonlyMap<string, string>[] = [];
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

  /** A plain name: a letter or `_`, then letters, digits, `_`, `-`, `.`. */
  const readPlainName = (): void => {
    if (i >= length) fail("truncated");
    if (!isNameStart(text.charCodeAt(i))) fail("name");
    i += 1;
    while (i < length && isNameChar(text.charCodeAt(i))) i += 1;
  };

  /** A name; in the OOXML profile, with at most one `prefix:`. */
  const readName = (): string => {
    const start = i;
    readPlainName();
    if (i < length && text.charCodeAt(i) === COLON) {
      // A namespace prefix, which only the OOXML profile has.
      if (!ooxml) fail("name");
      i += 1;
      readPlainName();
      if (i < length && text.charCodeAt(i) === COLON) fail("name");
    }
    if (i - start > MAX_NAME_LENGTH) fail("name");
    return text.slice(start, i);
  };

  /**
   * The namespace a prefix is bound to, innermost declaration first; for
   * "", an element's default namespace, "" where none is declared. An
   * undeclared prefix is an error, never a guess.
   */
  const resolve = (prefix: string): string => {
    if (prefix === "xml") return XML_NAMESPACE;
    for (let k = scopes.length - 1; k >= 0; k -= 1) {
      const uri = (scopes[k] as ReadonlyMap<string, string>).get(prefix);
      if (uri !== undefined) return uri;
    }
    return prefix === "" ? "" : fail("namespace");
  };

  /**
   * The namespaces a tag declares, as Namespaces in XML 1.0 §3 allows them:
   * `xmlns` is never declared, `xml` only as itself, no other prefix bound
   * to either's namespace, and a prefix never to "" (only the default
   * namespace is undeclared that way).
   */
  const declarations = (
    written: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> => {
    let frame: Map<string, string> | undefined;
    for (const [key, uri] of written) {
      let prefix: string;
      if (key === "xmlns") prefix = "";
      else if (key.startsWith("xmlns:")) prefix = key.slice(6);
      else continue;
      if (prefix === "xml") {
        if (uri !== XML_NAMESPACE) fail("namespace");
        continue;
      }
      if (prefix === "xmlns") fail("namespace");
      if (uri === XML_NAMESPACE || uri === XMLNS_NAMESPACE) fail("namespace");
      if (prefix !== "" && uri === "") fail("namespace");
      frame ??= new Map();
      frame.set(prefix, uri);
    }
    return frame ?? NO_DECLARATIONS;
  };

  /**
   * A tag's attributes, a prefixed one as `{uri}local`, without the
   * declarations. Two prefixes bound to one namespace name one attribute
   * twice: a duplicate (Namespaces in XML 1.0 §6.3).
   */
  const qualified = (
    written: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> => {
    const attributes = new Map<string, string>();
    for (const [key, value] of written) {
      if (key === "xmlns" || key.startsWith("xmlns:")) continue;
      const colon = key.indexOf(":");
      const name =
        colon === -1
          ? key
          : `{${resolve(key.slice(0, colon))}}${key.slice(colon + 1)}`;
      if (attributes.has(name)) fail("duplicateAttribute");
      attributes.set(name, value);
    }
    return attributes;
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
        start = i;
      } else if (ooxml && (c === TAB || c === NEWLINE || c === RETURN)) {
        // XML 1.0 §3.3.3: white space written in a value is read as a
        // space, a CR LF pair as one; a reference such as `&#9;` is kept.
        parts.push(text.slice(start, i), " ");
        const pair = c === RETURN && text.charCodeAt(i + 1) === NEWLINE;
        if (c === NEWLINE || pair) line += 1;
        i += pair ? 2 : 1;
        start = i;
      } else {
        nextChar();
      }
      size += 1;
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
    const written = new Map<string, string>();
    // Whether the tag names a prefix or declares one, so that its
    // attributes need resolving (OOXML only).
    let prefixed = false;
    for (;;) {
      const before = i;
      skipSpace();
      if (i >= length) fail("truncated");
      const c = text.charCodeAt(i);
      if (c === GT || c === SLASH) break;
      // Attributes are separated by whitespace.
      if (i === before) fail("attributeSyntax");
      const key = readName();
      if (written.has(key)) fail("duplicateAttribute");
      if (written.size >= LIMITS.xmlAttributes) fail("tooManyAttributes");
      if (key.startsWith("xmlns") || key.includes(":")) {
        // A declaration, which only the OOXML profile has.
        if (!ooxml) fail("name");
        prefixed = true;
      }
      skipSpace();
      if (text.charCodeAt(i) !== EQUALS) fail("attributeSyntax");
      i += 1;
      skipSpace();
      written.set(key, readValue());
    }
    const empty = text.charCodeAt(i) === SLASH;
    if (empty) {
      i += 1;
      if (i >= length) fail("truncated");
      if (text.charCodeAt(i) !== GT) fail("attributeSyntax");
    }
    i += 1; // >
    budget.elements -= 1;
    if (budget.elements < 0) fail("tooManyElements");
    if (open.length >= LIMITS.xmlDepth) fail("tooDeep");
    root.seen = true;
    const depth = open.length + 1;

    let namespace = "";
    let local = name;
    let attributes: ReadonlyMap<string, string> = written;
    if (ooxml) {
      // Declarations first, wherever they stand in the tag: they bind the
      // element's own prefix and its attributes' too.
      scopes.push(prefixed ? declarations(written) : NO_DECLARATIONS);
      const colon = name.indexOf(":");
      namespace = resolve(colon === -1 ? "" : name.slice(0, colon));
      local = colon === -1 ? name : name.slice(colon + 1);
      if (prefixed) attributes = qualified(written);
    }
    visitor.open({ name, namespace, local, attributes, depth, line: tagLine });
    if (empty) {
      visitor.close(name, depth);
      if (ooxml) scopes.pop();
      if (depth === 1) root.closed = true;
    } else {
      open.push(name);
    }
  };

  /**
   * Text at `i` up to the next tag, inside an element: the OOXML profile's.
   * References are decoded and white space is kept, line ends normalized.
   */
  const readText = () => {
    const parts: string[] = [];
    let start = i;
    let size = 0;
    while (i < length && text.charCodeAt(i) !== LT) {
      const c = text.charCodeAt(i);
      if (c === AMPERSAND) {
        parts.push(text.slice(start, i));
        i += 1;
        parts.push(readReference());
        start = i;
      } else if (c === RETURN) {
        // XML 1.0 §2.11: a CR LF pair, or a CR alone, is read as one LF;
        // `&#13;` is how a CR is written to be kept.
        parts.push(text.slice(start, i), "\n");
        const pair = text.charCodeAt(i + 1) === NEWLINE;
        if (pair) line += 1;
        i += pair ? 2 : 1;
        start = i;
      } else {
        // `]]>` may end only a CDATA section, which the profile refuses.
        if (c === GT && text.startsWith("]]", i - 2)) fail("cdataEnd");
        nextChar();
      }
      size += 1;
      if (size > LIMITS.xlsxCellLength) fail("valueTooLong");
    }
    parts.push(text.slice(start, i));
    const value = parts.join("");
    if (visitor.text !== undefined) visitor.text(value, open.length);
    else if (!isBlank(value)) fail("text");
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
    if (ooxml) scopes.pop();
    if (open.length === 0) root.closed = true;
  };

  if (text.startsWith("<?xml") && length > 5 && isSpace(text.charCodeAt(5))) {
    readDeclaration();
  }

  while (i < length) {
    const c = text.charCodeAt(i);
    // Inside an element, the OOXML profile's text is read whole, white
    // space first: `<t xml:space="preserve">  a</t>` keeps its spaces.
    if (ooxml && open.length > 0 && c !== LT) {
      readText();
      continue;
    }
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
