import { describe, expect, it } from "vitest";

import { en, sl, type Messages } from "./messages";

type Node =
  string | readonly unknown[] | ((...args: never[]) => unknown) | object;

/** Every string a catalog can produce: plain strings and message outputs. */
function strings(node: Node, path: string, out: [string, string][]): void {
  if (typeof node === "string") {
    out.push([path, node]);
  } else if (typeof node === "function") {
    // Render each message twice: with positional placeholder strings, and with
    // one object whose every property is a placeholder, so both message styles
    // produce their full text whichever one the function uses.
    const fn = node as (...args: unknown[]) => unknown;
    const target = { toString: () => "<p>" };
    const params = new Proxy(target, {
      get: (t, key) =>
        key in t || typeof key === "symbol"
          ? (Reflect.get(t, key) as unknown)
          : `<${key}>`,
    });
    strings(fn("<a>", "<b>", "<c>", "<d>") as Node, `${path}(a, b, c, d)`, out);
    strings(fn(params) as Node, `${path}(p)`, out);
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => {
      strings(item as Node, `${path}[${String(i)}]`, out);
    });
  } else {
    for (const [key, value] of Object.entries(node)) {
      strings(value as Node, path === "" ? key : `${path}.${key}`, out);
    }
  }
}

function collect(messages: Messages): [string, string][] {
  const out: [string, string][] = [];
  strings(messages, "", out);
  return out;
}

/** The shape of a catalog: keys, array lengths and leaf kinds, not wording. */
function shape(node: unknown): unknown {
  if (typeof node === "function") return "function";
  if (typeof node === "string") return "string";
  if (Array.isArray(node)) return node.map(shape);
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .sort(([a], [b]) => a.localeCompare(b))
        // Slovenian adds dual and "few" plural forms; English does not need them.
        .filter(([key]) => key !== "two" && key !== "few")
        .map(([key, value]) => [key, shape(value)]),
    );
  }
  return typeof node;
}

describe("message catalogs", () => {
  it("have the same keys, lists and parameterised messages in both languages", () => {
    expect(shape(sl)).toEqual(shape(en));
  });

  it("render every message to a non-empty string", () => {
    for (const [path, text] of [...collect(en), ...collect(sl)]) {
      expect(text.trim(), path).not.toBe("");
    }
  });

  it("contain no em or en dashes (house style)", () => {
    for (const [path, text] of [...collect(en), ...collect(sl)]) {
      expect(text, path).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("give Slovenian plural forms for the dual and 'few' wherever they are used", () => {
    for (const forms of [
      sl.files.rows,
      sl.review.years,
      sl.download.kdvpBody,
      sl.download.divBody,
    ]) {
      expect(forms.two).toContain("{n}");
      expect(forms.few).toContain("{n}");
    }
  });

  it("keep the import steps and the four 'how it works' steps aligned", () => {
    expect(sl.start.steps).toHaveLength(4);
    for (const forms of [1, 2]) {
      expect(sl.download.importSteps("d", forms)).toHaveLength(
        en.download.importSteps("d", forms).length,
      );
    }
    // Only a return with both forms asks to repeat the import.
    expect(en.download.importSteps("d", 1).at(-1)).not.toContain("second");
    expect(en.download.importSteps("d", 2).at(-1)).toContain("second");
  });
});
