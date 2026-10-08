/**
 * A small XML writer for FURS forms. Elements are values, text is escaped on
 * the way out, and nothing is concatenated into markup by hand (CLAUDE.md,
 * "Secure code"). It covers what eDavki documents need and nothing more:
 * element-only or text-only content, and attributes only for namespace
 * declarations.
 */

export interface XmlElement {
  readonly name: string;
  readonly attributes: readonly (readonly [string, string])[];
  /** Child elements, or the element's text; never both. */
  readonly content: readonly XmlElement[] | string;
}

/** A child slot that may be left out: optional elements are omitted, never written empty. */
export type XmlChild = XmlElement | null | undefined | false;

const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;

/** The messages name the rule, never the value, which may be user data. */
function checkName(name: string): string {
  if (!NAME.test(name)) throw new Error("Not an XML element or attribute name");
  return name;
}

/**
 * True when the text can be written into an XML document at all. XML 1.0
 * cannot carry, even escaped, the C0 controls other than tab, line feed and
 * carriage return, U+FFFE and U+FFFF, or half of a surrogate pair.
 */
export function isXmlText(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) {
      return false;
    }
    if (unit === 0xfffe || unit === 0xffff) return false;
    if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    }
  }
  return true;
}

function checkAttribute(value: string): string {
  if (!isXmlText(value)) {
    throw new Error("An attribute contains a character XML cannot carry");
  }
  return value;
}

/** An element holding other elements; skipped children leave no trace. */
export function element(
  name: string,
  children: readonly XmlChild[] = [],
  attributes: readonly (readonly [string, string])[] = [],
): XmlElement {
  return {
    name: checkName(name),
    attributes: attributes.map(([key, value]) => [
      checkName(key),
      checkAttribute(value),
    ]),
    content: children.filter((child): child is XmlElement => Boolean(child)),
  };
}

/**
 * Text content as it may be written. Empty text is refused: an empty typed
 * element fails the schema (a decimal cannot be ""), so a value that is
 * absent must be omitted with `optional`, never written empty.
 */
function checkContent(name: string, value: string): string {
  if (value === "") {
    throw new Error(`Empty text for <${name}>; omit it instead`);
  }
  if (!isXmlText(value)) {
    throw new Error(`<${name}> contains a character XML cannot carry`);
  }
  return value;
}

/** An element holding text. */
export function text(name: string, value: string): XmlElement {
  return {
    name: checkName(name),
    attributes: [],
    content: checkContent(name, value),
  };
}

/** `text` for a value that may be absent; `null`, as JSON writes it, is absent. */
export function optional(
  name: string,
  value: string | null | undefined,
): XmlElement | null {
  return value === undefined || value === null ? null : text(name, value);
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "&#13;");
}

function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#9;");
}

function write(node: XmlElement, depth: number, out: string[]): void {
  // An XmlElement is a plain object, so one built by hand would skip the
  // checks in element() and text(); the writer repeats them rather than
  // trust its input, and no name or text reaches the output unchecked.
  const name = checkName(node.name);
  const pad = "  ".repeat(depth);
  const attributes = node.attributes
    .map(
      ([key, value]) =>
        ` ${checkName(key)}="${escapeAttribute(checkAttribute(value))}"`,
    )
    .join("");
  if (typeof node.content === "string") {
    const content = escapeText(checkContent(name, node.content));
    out.push(`${pad}<${name}${attributes}>${content}</${name}>`);
  } else if (node.content.length === 0) {
    out.push(`${pad}<${name}${attributes}/>`);
  } else {
    out.push(`${pad}<${name}${attributes}>`);
    for (const child of node.content) write(child, depth + 1, out);
    out.push(`${pad}</${name}>`);
  }
}

/**
 * The document as UTF-8 text: an XML declaration, two-space indentation
 * between elements (never inside text), and a final newline. Deterministic,
 * so golden files can compare byte for byte.
 */
export function serialize(root: XmlElement): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  write(root, 0, out);
  return `${out.join("\n")}\n`;
}
