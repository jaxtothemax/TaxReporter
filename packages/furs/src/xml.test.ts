import { describe, expect, it } from "vitest";

import {
  element,
  isXmlText,
  optional,
  serialize,
  text,
  type XmlElement,
} from "./xml.js";

describe("serialize", () => {
  it("writes a declaration, indented elements, unindented text and a final newline", () => {
    const xml = serialize(
      element(
        "Root",
        [element("Empty"), text("A", "1"), element("B", [text("C", "x")])],
        [["xmlns", "urn:test"]],
      ),
    );
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Root xmlns="urn:test">',
        "  <Empty/>",
        "  <A>1</A>",
        "  <B>",
        "    <C>x</C>",
        "  </B>",
        "</Root>",
        "",
      ].join("\n"),
    );
  });

  it("escapes text, so a name can never become markup", () => {
    const xml = serialize(
      element("R", [text("Name", 'Procter & Gamble <Co> "P&G" it\'s')]),
    );
    expect(xml).toContain(
      '<Name>Procter &amp; Gamble &lt;Co&gt; "P&amp;G" it\'s</Name>',
    );
    expect(serialize(element("R", [text("T", "a\rb")]))).toContain(
      "<T>a&#13;b</T>",
    );
  });

  it("escapes attribute values", () => {
    expect(serialize(element("R", [], [["xmlns", 'a"b<c>&\n\t']]))).toContain(
      '<R xmlns="a&quot;b&lt;c&gt;&amp;&#10;&#9;"/>',
    );
  });

  it("keeps non-ASCII text as it is, for UTF-8 output", () => {
    expect(
      serialize(element("R", [text("C", "Königinstraße, člen")])),
    ).toContain("<C>Königinstraße, člen</C>");
  });
});

describe("element and text", () => {
  it("omits children that are absent", () => {
    const node = element("R", [
      optional("A", undefined),
      null,
      false,
      text("B", "1"),
    ]);
    expect(serialize(node)).not.toContain("<A");
    expect(serialize(node)).toContain("<B>1</B>");
  });

  it("refuses empty text: an absent value is omitted, never written empty", () => {
    expect(() => text("F4", "")).toThrow(/omit it/);
  });

  it("refuses characters XML cannot carry, without echoing the value", () => {
    expect(() => text("PayerName", "A\u0001B")).toThrow(
      "<PayerName> contains a character XML cannot carry",
    );
    expect(isXmlText("ok\ttab\nline")).toBe(true);
    expect(isXmlText("\uFFFF")).toBe(false);
    expect(isXmlText("\uD800")).toBe(false);
    expect(isXmlText("\uD83D\uDE00")).toBe(true);
  });

  it("refuses element and attribute names that are not names", () => {
    expect(() => element("bad name")).toThrow(/attribute name/);
    expect(() => text("<x>", "1")).toThrow(/attribute name/);
    expect(() => element("R", [], [["on click", "x"]])).toThrow(
      /attribute name/,
    );
    expect(() => element("edp:Header")).not.toThrow();
  });

  it("does not repeat a refused name, which could be user data", () => {
    expect(() => element("Janez Novak")).toThrow(
      /^Not an XML element or attribute name$/,
    );
  });

  it("refuses an attribute value XML cannot carry", () => {
    expect(() =>
      element("R", [], [["xmlns", `urn:${String.fromCharCode(0)}`]]),
    ).toThrow("An attribute contains a character XML cannot carry");
  });

  it("treats null, as JSON writes an absent value, as absent", () => {
    expect(optional("A", null)).toBeNull();
  });
});

describe("serialize, given elements built by hand", () => {
  // An XmlElement is a plain object; one that skipped element() and text()
  // must still never reach the output unchecked.
  const forged = (node: unknown) => () => serialize(node as XmlElement);

  it("re-checks names", () => {
    expect(
      forged({
        name: "R",
        attributes: [],
        content: [{ name: 'x><y a="', attributes: [], content: "1" }],
      }),
    ).toThrow("Not an XML element or attribute name");
    expect(
      forged({ name: "R", attributes: [["a b", "1"]], content: [] }),
    ).toThrow("Not an XML element or attribute name");
  });

  it("re-checks text and attribute values", () => {
    expect(
      forged({
        name: "R",
        attributes: [],
        content: `a${String.fromCharCode(1)}`,
      }),
    ).toThrow("<R> contains a character XML cannot carry");
    expect(forged({ name: "R", attributes: [], content: "" })).toThrow(
      /omit it/,
    );
    expect(
      forged({
        name: "R",
        attributes: [["xmlns", String.fromCharCode(0xffff)]],
        content: [],
      }),
    ).toThrow("An attribute contains a character XML cannot carry");
  });
});
