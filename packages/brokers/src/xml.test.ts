import { LIMITS } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { scanXml, XmlError, type XmlElement } from "./xml.js";

/** What the scanner saw, as "open Name a=1" and "close Name" lines. */
function events(text: string): string[] {
  const seen: string[] = [];
  scanXml(text, {
    open: (e: XmlElement) => {
      const attributes = [...e.attributes].map(([k, v]) => `${k}=${v}`);
      seen.push([`open ${e.name}@${String(e.depth)}`, ...attributes].join(" "));
    },
    close: (name, depth) => seen.push(`close ${name}@${String(depth)}`),
  });
  return seen;
}

/** The refusal's code, or "none". */
function refusal(text: string): string {
  try {
    events(text);
    return "none";
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    return error.code;
  }
}

describe("scanXml", () => {
  it("reads elements and attributes, empty and nested, in order", () => {
    expect(
      events(
        '<?xml version="1.0" encoding="UTF-8"?>\n<A x="1">\n  <B y=\'2\' z="&lt;&amp;&#65;&#x42;"/>\n</A>\n',
      ),
    ).toEqual([
      "open A@1 x=1",
      "open B@2 y=2 z=<&AB",
      "close B@2",
      "close A@1",
    ]);
  });

  it("skips comments, and takes the declaration only at the very start", () => {
    expect(events("<!-- made by a broker --><A/><!-- end -->")).toEqual([
      "open A@1",
      "close A@1",
    ]);
    expect(refusal(' <?xml version="1.0"?><A/>')).toBe("processingInstruction");
    expect(refusal('<?xml version="1.1"?><A/>')).toBe("declaration");
    expect(refusal('<?xml version="1.0" encoding="UTF-16"?><A/>')).toBe(
      "declaration",
    );
  });

  it("refuses everything but elements and attributes", () => {
    const cases: [string, string][] = [
      ['<!DOCTYPE A [<!ENTITY x "y">]><A/>', "doctype"],
      ["<A>&x;</A>", "text"],
      ['<A b="&x;"/>', "entity"],
      ['<A b="&#0;"/>', "characterReference"],
      ['<A b="&#xD800;"/>', "characterReference"],
      ['<A b="&#xFFFE;"/>', "characterReference"],
      ['<A b="&#x110000;"/>', "characterReference"],
      ['<A b="&#123456789;"/>', "characterReference"],
      ["<A><![CDATA[x]]></A>", "cdata"],
      ["<A><?pi x?></A>", "processingInstruction"],
      ["<A>text</A>", "text"],
      ['<A xmlns="urn:x"/>', "name"],
      ['<x:A xmlns:x="urn:x"/>', "name"],
      ["<Ä/>", "name"],
      ['<A b="1" b="2"/>', "duplicateAttribute"],
      ['<A b="1"c="2"/>', "attributeSyntax"],
      ["<A b=1/>", "attributeSyntax"],
      ['<A b="<"/>', "lessThanInValue"],
      ["<A></B>", "mismatchedEnd"],
      ["<A/><B/>", "afterRoot"],
      ["<A/>text", "text"],
      ["﻿<A/>", "text"],
      ["<A b='\u0001'/>", "illegalCharacter"],
      ["<!-- a -- b --><A/>", "comment"],
      ["", "noRoot"],
      ["<!-- only a comment -->", "noRoot"],
    ];
    for (const [text, code] of cases) expect(refusal(text), text).toBe(code);
  });

  it("keeps the characters a reference may name, the bidi ones included", () => {
    // Allowed by XML; the form's own checks neutralize them downstream.
    expect(events('<A b="&#x202E;"/>')[0]).toBe("open A@1 b=‮");
  });

  it("refuses a document cut short anywhere", () => {
    const whole = '<A x="1"><B y="&amp;"/><!-- c --></A>';
    for (let end = 1; end < whole.length; end += 1) {
      expect(refusal(whole.slice(0, end)), whole.slice(0, end)).not.toBe(
        "none",
      );
    }
    expect(refusal(whole)).toBe("none");
  });

  it("holds its limits at their value, and refuses one past them", () => {
    const nested = (depth: number) =>
      `${"<A>".repeat(depth)}${"</A>".repeat(depth)}`;
    expect(refusal(nested(LIMITS.xmlDepth))).toBe("none");
    expect(refusal(nested(LIMITS.xmlDepth + 1))).toBe("tooDeep");

    const attributes = (n: number) =>
      `<A ${Array.from({ length: n }, (_, k) => `a${String(k)}="1"`).join(" ")}/>`;
    expect(refusal(attributes(LIMITS.xmlAttributes))).toBe("none");
    expect(refusal(attributes(LIMITS.xmlAttributes + 1))).toBe(
      "tooManyAttributes",
    );

    const value = (n: number) => `<A b="${"x".repeat(n)}"/>`;
    expect(refusal(value(LIMITS.cellLength))).toBe("none");
    expect(refusal(value(LIMITS.cellLength + 1))).toBe("valueTooLong");

    const name = (n: number) => `<${"A".repeat(n)}/>`;
    expect(refusal(name(64))).toBe("none");
    expect(refusal(name(65))).toBe("name");
  });

  it("stays linear on input made to be slow", () => {
    const size = 4 * 1024 * 1024;
    const started = Date.now();
    for (const text of [
      "<".repeat(size),
      `<A b="${"x".repeat(size)}`,
      `<A b="${"&#1".repeat(size / 3)}"/>`,
      `<A>${" ".repeat(size)}`,
    ]) {
      expect(refusal(text)).not.toBe("none");
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("names the line it stopped on, never the text", () => {
    try {
      events('<A>\n\n<B c="SECRET-U1234567" c="x"/></A>');
      throw new Error("not refused");
    } catch (error) {
      if (!(error instanceof XmlError)) throw error;
      expect([error.code, error.line]).toEqual(["duplicateAttribute", 3]);
      expect(error.message).not.toContain("SECRET");
    }
  });
});
