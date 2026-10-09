import { LIMITS } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import { MAX_XML_ELEMENTS, scanXml, XmlError, type XmlElement } from "./xml.js";

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
      ["<x:A/>", "name"],
      ['<A x:b="1"/>', "name"],
      ["<Ä/>", "name"],
      ['<A b="1" b="2"/>', "duplicateAttribute"],
      ['<A b="1"c="2"/>', "attributeSyntax"],
      ["<A b=1/>", "attributeSyntax"],
      ['<A b="<"/>', "lessThanInValue"],
      ["<A></B>", "mismatchedEnd"],
      ["<A/><B/>", "afterRoot"],
      ["<A/>text", "text"],
      ["\uFEFF<A/>", "text"],
      ["<A b='\u0001'/>", "illegalCharacter"],
      ["<!-- a -- b --><A/>", "comment"],
      ["", "noRoot"],
      ["<!-- only a comment -->", "noRoot"],
    ];
    for (const [text, code] of cases) expect(refusal(text), text).toBe(code);
  });

  it("keeps the characters a reference may name, the bidi ones included", () => {
    // Allowed by XML; the form's own checks neutralize them downstream.
    expect(events('<A b="&#x202E;"/>')[0]).toBe("open A@1 b=\u202E");
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

  it("counts its elements to the cap, and refuses one past it", () => {
    const elements = (n: number) => `<R>${"<A/>".repeat(n - 1)}</R>`;
    expect(refusal(elements(MAX_XML_ELEMENTS))).toBe("none");
    expect(refusal(elements(MAX_XML_ELEMENTS + 1))).toBe("tooManyElements");
  });

  it("keeps a value as written, white space and all", () => {
    expect(events('<A b="x\ty"/>')).toEqual(["open A@1 b=x\ty", "close A@1"]);
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

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** What the OOXML profile saw: names as `{uri}local`, text as JSON. */
function ooxmlEvents(text: string, budget?: { elements: number }): string[] {
  const seen: string[] = [];
  scanXml(
    text,
    {
      open: (e: XmlElement) => {
        const attributes = [...e.attributes].map(([k, v]) => `${k}=${v}`);
        const name =
          e.namespace === "" ? e.local : `{${e.namespace}}${e.local}`;
        seen.push([`open ${name}@${String(e.depth)}`, ...attributes].join(" "));
      },
      close: (name, depth) => seen.push(`close ${name}@${String(depth)}`),
      text: (value, depth) =>
        seen.push(`text@${String(depth)} ${JSON.stringify(value)}`),
    },
    budget === undefined ? { ooxml: true } : { ooxml: true, budget },
  );
  return seen;
}

/** The OOXML profile's refusal code, or "none"; `bare` passes no text. */
function ooxmlRefusal(
  text: string,
  budget?: { elements: number },
  bare = false,
): string {
  try {
    if (bare) {
      scanXml(
        text,
        { open: () => undefined, close: () => undefined },
        { ooxml: true },
      );
    } else {
      ooxmlEvents(text, budget);
    }
    return "none";
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    return error.code;
  }
}

describe("scanXml, OOXML profile", () => {
  it("names elements by namespace and local name, attributes by {uri}local", () => {
    expect(
      ooxmlEvents(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<workbook xmlns="${MAIN}" xmlns:r="${RELS}"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    ).toEqual([
      `open {${MAIN}}workbook@1`,
      `open {${MAIN}}sheets@2`,
      `open {${MAIN}}sheet@3 name=A sheetId=1 {${RELS}}id=rId1`,
      "close sheet@3",
      "close sheets@2",
      "close workbook@1",
    ]);
  });

  it("resolves a prefix to its innermost declaration, within its element", () => {
    expect(
      ooxmlEvents('<x:a xmlns:x="urn:1"><x:b xmlns:x="urn:2"/><x:c/></x:a>'),
    ).toEqual([
      "open {urn:1}a@1",
      "open {urn:2}b@2",
      "close x:b@2",
      "open {urn:1}c@2",
      "close x:c@2",
      "close x:a@1",
    ]);
    // A declaration after the name it binds, in the same tag.
    expect(ooxmlEvents('<x:a b="1" xmlns:x="urn:1"/>')).toEqual([
      "open {urn:1}a@1 b=1",
      "close x:a@1",
    ]);
    // The default namespace, undeclared again by xmlns="".
    expect(ooxmlEvents('<a xmlns="urn:1"><b xmlns=""><c/></b></a>')).toEqual([
      "open {urn:1}a@1",
      "open b@2",
      "open c@3",
      "close c@3",
      "close b@2",
      "close a@1",
    ]);
    // `xml` is bound without a declaration, and may be declared as itself.
    expect(
      ooxmlEvents(`<t xml:space="preserve" xmlns:xml="${XML_NS}"/>`),
    ).toEqual([`open t@1 {${XML_NS}}space=preserve`, "close t@1"]);
  });

  it("refuses what Namespaces in XML forbids", () => {
    const cases: [string, string][] = [
      ["<x:a/>", "namespace"],
      ['<a x:b="1"/>', "namespace"],
      ['<r><a xmlns:x="urn:1"/><x:b/></r>', "namespace"],
      ['<r><a xmlns:x="urn:1"></a><x:b/></r>', "namespace"],
      ['<a xmlns:x=""/>', "namespace"],
      ['<a xmlns:xmlns="urn:1"/>', "namespace"],
      ['<a xmlns:xml="urn:1"/>', "namespace"],
      [`<a xmlns:x="${XML_NS}"/>`, "namespace"],
      [`<a xmlns="${XMLNS_NS}"/>`, "namespace"],
      [`<a xmlns:x="${XMLNS_NS}"/>`, "namespace"],
      ["<xmlns:a/>", "namespace"],
      [
        '<a xmlns:x="urn:1" xmlns:y="urn:1" x:b="1" y:b="2"/>',
        "duplicateAttribute",
      ],
      ['<a xmlns="urn:1" xmlns="urn:2"/>', "duplicateAttribute"],
      ["<a:b:c/>", "name"],
      ['<a b:="1"/>', "name"],
    ];
    for (const [text, code] of cases) {
      expect(ooxmlRefusal(text), text).toBe(code);
    }
  });

  it("passes text whole, references decoded and line ends normalized", () => {
    expect(ooxmlEvents("<t>  a &amp; b&#13;\r\nc\rd </t>")).toEqual([
      "open t@1",
      `text@1 ${JSON.stringify("  a & b\r\nc\nd ")}`,
      "close t@1",
    ]);
    // White space between elements is text too; a comment splits it.
    expect(ooxmlEvents("<a>\n <b>x<!-- c -->y</b></a>")).toEqual([
      "open a@1",
      `text@1 ${JSON.stringify("\n ")}`,
      "open b@2",
      'text@2 "x"',
      'text@2 "y"',
      "close b@2",
      "close a@1",
    ]);
    expect(ooxmlEvents("<t>a]]&gt;b</t>")[1]).toBe('text@1 "a]]>b"');
  });

  it("normalizes attribute values as XML does", () => {
    expect(ooxmlEvents('<a b="x\ty\nz\r\nw\rv&#9;u"/>')[0]).toBe(
      "open a@1 b=x y z w v\tu",
    );
  });

  it("refuses what XML refuses in text, and text where none is wanted", () => {
    const cases: [string, string][] = [
      ["<t>a]]>b</t>", "cdataEnd"],
      ["<t>\u0001</t>", "illegalCharacter"],
      ["<t>\uD800</t>", "illegalCharacter"],
      ["<t>&x;</t>", "entity"],
      ["<t><![CDATA[x]]></t>", "cdata"],
      ["<t><?pi x?></t>", "processingInstruction"],
      ["<!DOCTYPE t><t/>", "doctype"],
      ["<t/>x", "text"],
    ];
    for (const [text, code] of cases) {
      expect(ooxmlRefusal(text), text).toBe(code);
    }
    // Without a text visitor, white space alone passes; a no-break space
    // is no XML white space.
    expect(ooxmlRefusal("<a>\n\t </a>", undefined, true)).toBe("none");
    expect(ooxmlRefusal("<a>x</a>", undefined, true)).toBe("text");
    expect(ooxmlRefusal("<a>\u00A0</a>", undefined, true)).toBe("text");
  });

  it("holds the text limit at its value, and refuses one past it", () => {
    const text = (piece: string, n: number) => `<t>${piece.repeat(n)}</t>`;
    expect(ooxmlRefusal(text("x", LIMITS.xlsxCellLength))).toBe("none");
    expect(ooxmlRefusal(text("x", LIMITS.xlsxCellLength + 1))).toBe(
      "valueTooLong",
    );
    expect(ooxmlRefusal(text("&amp;", LIMITS.xlsxCellLength))).toBe("none");
    expect(ooxmlRefusal(text("\r\n", LIMITS.xlsxCellLength + 1))).toBe(
      "valueTooLong",
    );
  });

  it("counts elements against one budget, shared by every scan of a file", () => {
    const budget = { elements: 5 };
    ooxmlEvents("<a><b/></a>", budget);
    expect(budget.elements).toBe(3);
    ooxmlEvents("<a><b/><c/></a>", budget);
    expect(budget.elements).toBe(0);
    expect(ooxmlRefusal("<a/>", budget)).toBe("tooManyElements");
    expect(ooxmlRefusal("<a><b/></a>", { elements: 1 })).toBe(
      "tooManyElements",
    );
  });

  it("refuses a document cut short anywhere", () => {
    const whole = '<x:a xmlns:x="urn:1" b="1">t&amp;<x:b/><!-- c -->\r\n</x:a>';
    for (let end = 1; end < whole.length; end += 1) {
      const cut = whole.slice(0, end);
      expect(ooxmlRefusal(cut), cut).not.toBe("none");
    }
    expect(ooxmlRefusal(whole)).toBe("none");
  });

  it("stays linear on input made to be slow", () => {
    const size = 4 * 1024 * 1024;
    // Fifteen frames of declarations above an element whose prefix the
    // outermost declares: each name resolves through all of them.
    const frames = Array.from(
      { length: LIMITS.xmlDepth - 1 },
      (_, k) =>
        `<f ${Array.from({ length: 200 }, (_, n) => `xmlns:p${String(n)}="urn:${String(k)}"`).join(" ")}>`,
    ).join("");
    const deep = `<r xmlns:q="urn:q">${frames}${'<q:b q:c="1"/>'.repeat(size / 16)}`;
    const started = Date.now();
    for (const text of [
      `<t>${"\r".repeat(size)}</t>`,
      `<t>${"&amp;".repeat(size / 5)}</t>`,
      `<t>${"a]]".repeat(size / 3)}</t>`,
      deep,
    ]) {
      expect(ooxmlRefusal(text, { elements: size })).not.toBe("none");
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("names the line it stopped on, a CR LF pair counted once", () => {
    try {
      ooxmlEvents("<t>SECRET\r\nb\r\n]]></t>");
      throw new Error("not refused");
    } catch (error) {
      if (!(error instanceof XmlError)) throw error;
      expect([error.code, error.line]).toEqual(["cdataEnd", 3]);
      expect(error.message).not.toContain("SECRET");
    }
  });
});
