import { describe, expect, it } from "vitest";

import { element, isXmlText, optional, serialize, text } from "./xml.js";

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
    expect(() => element("bad name")).toThrow(/element name/);
    expect(() => text("<x>", "1")).toThrow(/element name/);
    expect(() => element("R", [], [["on click", "x"]])).toThrow(/element name/);
    expect(() => element("edp:Header")).not.toThrow();
  });
});
