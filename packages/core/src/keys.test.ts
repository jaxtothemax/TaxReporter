/**
 * The key builder (ADR 0011 §5). The known answers were computed apart from
 * this code, with `shasum -a 256`, so a dependency bump or an encoding
 * change that alters a key fails here, never silently.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { Decimal } from "./decimal.js";
import {
  accountGroup,
  accountScope,
  digest,
  fileIdOf,
  keyBuilder,
  keyOf,
  sha256Prefix,
} from "./keys.js";

describe("sha256Prefix", () => {
  it("gives the NIST answers", () => {
    expect(sha256Prefix("abc")).toBe("ba7816bf8f01cfea414140de5dae2223");
    expect(sha256Prefix("")).toBe("e3b0c44298fc1c149afbf4c8996fb924");
    expect(
      sha256Prefix("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039");
  });

  it("agrees with Node's SHA-256 across every padding boundary", () => {
    for (let length = 0; length <= 300; length += 1) {
      const text = "é".repeat(length >> 1) + "x".repeat(length & 1);
      const expected = createHash("sha256")
        .update(text, "utf8")
        .digest("hex")
        .slice(0, 32);
      expect(sha256Prefix(text), String(length)).toBe(expected);
    }
  });
});

describe("fileIdOf", () => {
  it("takes the first 64 bits of the bytes' SHA-256", () => {
    expect(fileIdOf(new Uint8Array())).toBe("e3b0c44298fc1c14");
    expect(fileIdOf(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea");
  });
});

describe("keyBuilder", () => {
  const parts = [
    "EOF3214152",
    "2025-03-01T01:10:00Z",
    "US0378331005",
    Decimal.parse("1.50"),
    Decimal.parse("172.30"),
  ];

  it("hashes the canonical tuple, with an ordinal for each repeat in a file", () => {
    const keys = keyBuilder();
    expect(keys.key("trade", parts)).toBe("6acd68f9b85b9ba3fd6cdbeca3bbaef3");
    expect(keys.key("trade", parts)).toBe("ccf70fe97e660e0bc4a7ad0cf60945b0");
    expect(
      keys.key("dividend", [
        null,
        "2025-03-10",
        "IE00B3RBWM25",
        Decimal.parse("0.420"),
      ]),
    ).toBe("0b7846594934eb4cc738f57cd523b5d4");
  });

  it("gives the same row the same key in every file", () => {
    const first = keyBuilder();
    const second = keyBuilder();
    first.key("trade", ["EOF1"]);
    expect(second.key("trade", parts)).toBe(first.key("trade", parts));
  });

  it("writes a number the same however the file wrote it", () => {
    const keys = (amount: string) =>
      keyBuilder().key("trade", ["x", Decimal.parse(amount)]);
    expect(keys("1.50")).toBe(keys("1.5"));
    expect(keys("01.5")).toBe(keys("1.5"));
    expect(keys("1.5")).not.toBe(keys("1.05"));
  });

  it("tells kinds, parts and their boundaries apart", () => {
    const key = (kind: "trade" | "split", ...p: (string | null)[]) =>
      keyBuilder().key(kind, p);
    expect(key("trade", "a")).not.toBe(key("split", "a"));
    expect(key("trade", "ab", "c")).not.toBe(key("trade", "a", "bc"));
    expect(key("trade", null)).not.toBe(key("trade", "null"));
    // A lone surrogate is escaped, never read as U+FFFD.
    expect(key("trade", "\ud800")).toBe("e4175bd9e39aec99536993a9bab8f729");
    expect(key("trade", "\ud800")).not.toBe(key("trade", "�"));
  });

  it("refuses a number that is not whole", () => {
    expect(() => keyBuilder().key("trade", [1.5])).toThrow(RangeError);
    expect(() => keyBuilder().key("trade", [2 ** 53])).toThrow(RangeError);
    expect(keyBuilder().key("trade", [7])).toBe(digest(["v1", "trade", 7, 0]));
  });
});

describe("keyOf", () => {
  it("gives an event the broker identifies itself one key, however often it appears", () => {
    expect(keyOf("trade", ["700000102"])).toBe(
      "c3e9bed099a593f1edfeae9f3926db72",
    );
    expect(keyOf("trade", ["700000102"])).toBe(keyOf("trade", ["700000102"]));
    expect(keyOf("trade", ["700000102"])).not.toBe(
      keyBuilder().key("trade", ["700000102"]),
    );
    expect(keyOf("dividend", ["700000102"])).not.toBe(
      keyOf("trade", ["700000102"]),
    );
  });
});

describe("account scopes", () => {
  it("hides the account's own ID behind its broker", () => {
    const scope = accountScope("ibkr", "U1234567");
    expect(scope).toBe("ibkr:8ae70fcc23453d9548bc4578662e55ea");
    expect(scope).not.toContain("1234567");
    expect(accountScope("ibkr", "U7654321")).not.toBe(scope);
  });

  it("numbers the account groups the user forms", () => {
    expect(accountGroup("trading212", 1)).toBe("trading212:1");
    expect(() => accountGroup("trading212", 0)).toThrow(RangeError);
    expect(() => accountGroup("trading212", 1.5)).toThrow(RangeError);
  });
});
