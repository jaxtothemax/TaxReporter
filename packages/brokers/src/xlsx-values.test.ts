/**
 * Numbers and serials as research 09 settles them: its known answers, its
 * claim that any decimal of at most 15 digits comes back from any spelling
 * of its double, and the bounds.
 */
import { LIMITS } from "@taxreporter/core";
import { describe, expect, it } from "vitest";

import {
  cellInteger,
  cellNumber,
  serialDate,
  serialDateTime,
} from "./xlsx-values.js";

/** A deterministic stream of pseudo-random integers (xorshift32). */
function random(seed: number): (below: number) => number {
  let x = seed >>> 0 || 1;
  return (below) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % below;
  };
}

/** A decimal written plainly, trailing zeros dropped: what is expected. */
function canonical(digits: string, point: number): string {
  let d = digits.replace(/^0+/, "");
  if (d === "") return "0";
  const p = point - (digits.length - d.length);
  d = d.replace(/0+$/, "");
  if (p <= 0) return `0.${"0".repeat(-p)}${d}`;
  if (p >= d.length) return d + "0".repeat(p - d.length);
  return `${d.slice(0, p)}.${d.slice(p)}`;
}

describe("cellNumber", () => {
  it("gives research 09's known answers", () => {
    const cases: [string, string][] = [
      ["2.6315789999999998", "2.631579"],
      ["0.30000000000000004", "0.3"],
      ["-0", "0"],
      ["0", "0"],
      ["-0.000", "0"],
      ["1.4210854715202004E-14", "0.000000000000014210854715202"],
      ["45953", "45953"],
      ["1E3", "1000"],
      [".5", "0.5"],
      ["5.", "5"],
      ["+5", "5"],
      ["-1.5", "-1.5"],
      ["007.50", "7.5"],
      ["0.333333333333333", "0.333333333333333"],
    ];
    for (const [text, value] of cases)
      expect(cellNumber(text), text).toBe(value);
  });

  it("rounds at the 15th digit, ties away from zero, renormalizing a carry", () => {
    expect(cellNumber("0.1234567890123455")).toBe("0.123456789012346");
    expect(cellNumber("-0.1234567890123455")).toBe("-0.123456789012346");
    expect(cellNumber("0.1234567890123449999")).toBe("0.123456789012345");
    expect(cellNumber("999999999999999.5")).toBe("1000000000000000");
    expect(cellNumber("-9.999999999999999")).toBe("-10");
  });

  it("gives back every decimal of at most 15 digits, from any spelling of its double", () => {
    const next = random(20261009);
    for (let n = 0; n < 20_000; n += 1) {
      const length = 1 + next(15);
      const digits = Array.from({ length }, () => String(next(10))).join("");
      const point = next(31) - 15;
      const decimal = canonical(digits, point);
      const double = Number(decimal);
      for (const spelling of [
        String(double),
        double.toPrecision(17),
        double.toPrecision(40),
        double.toExponential(16),
      ]) {
        expect(cellNumber(spelling), `${decimal} as ${spelling}`).toBe(decimal);
      }
    }
  });

  it("holds the exponent bound at its value, and refuses one past it", () => {
    const bound = LIMITS.xlsxExponent;
    expect(cellNumber(`1E${String(bound)}`)).toBe(`1${"0".repeat(bound)}`);
    expect(cellNumber(`1E${String(bound + 1)}`)).toBeNull();
    expect(cellNumber(`1E-${String(bound)}`)).toBe(
      `0.${"0".repeat(bound - 1)}1`,
    );
    expect(cellNumber(`1E-${String(bound + 1)}`)).toBeNull();
    // A carry can take a value past the bound.
    expect(cellNumber(`9.999999999999999E${String(bound)}`)).toBeNull();
    // Subnormal doubles, and the largest ones, lie far past it.
    expect(cellNumber("4.9406564584124654E-324")).toBeNull();
    expect(cellNumber("1.7976931348623157E308")).toBeNull();
  });

  it("refuses what is no number", () => {
    for (const text of [
      "",
      ".",
      "-",
      "1e",
      "e5",
      "1.2.3",
      "INF",
      "NaN",
      "-INF",
      "1,5",
      " 1",
      "1 ",
      "0x10",
      "1e999999",
      "1".repeat(65),
    ]) {
      expect(cellNumber(text), text).toBeNull();
    }
  });
});

describe("cellInteger", () => {
  it("reads a whole number of at most 15 digits exactly", () => {
    expect(cellInteger("123456789012345")).toBe("123456789012345");
    expect(cellInteger("1.23456789012345E14")).toBe("123456789012345");
    expect(cellInteger("100")).toBe("100");
    expect(cellInteger("1.0")).toBe("1");
    expect(cellInteger("0")).toBe("0");
    // Zero has no sign, here as everywhere.
    expect(cellInteger("-0")).toBe("0");
  });

  it("refuses one a double cannot hold, a fraction or a sign", () => {
    expect(cellInteger("1234567890123456")).toBeNull();
    // 12345678901234567, stored, comes back as ...568.
    expect(cellInteger("12345678901234568")).toBeNull();
    expect(cellInteger("1.5")).toBeNull();
    expect(cellInteger("-1")).toBeNull();
    expect(cellInteger("x")).toBeNull();
  });
});

describe("serialDateTime", () => {
  it("gives research 09's known answers", () => {
    expect(serialDateTime("45953", false)).toEqual({
      date: "2025-10-23",
      time: "00:00:00",
    });
    expect(serialDateTime("45657.99998842592", false)).toEqual({
      date: "2024-12-31",
      time: "23:59:59",
    });
    // XTB's, at 15:33:12.442: truncated to the second.
    expect(serialDateTime("45716.648060671301", false)).toEqual({
      date: "2025-02-28",
      time: "15:33:12",
    });
    // Noise below a millisecond before midnight is snapped away.
    expect(serialDateTime("45657.99999999999", false)).toEqual({
      date: "2025-01-01",
      time: "00:00:00",
    });
    expect(serialDateTime("44491", false)?.date).toBe("2021-10-22");
    expect(serialDateTime("44491", true)?.date).toBe("2025-10-23");
  });

  it("never rounds into the next day, or the next tax year", () => {
    // 23:59:59.5 on 31 December 2025 stays in 2025.
    const half = "46022.999994212963"; // 86,399.5 s of 86,400
    expect(serialDateTime(half, false)).toEqual({
      date: "2025-12-31",
      time: "23:59:59",
    });
    // 8.64 ms before midnight is still the same day.
    expect(serialDateTime("45657.9999999", false)).toEqual({
      date: "2024-12-31",
      time: "23:59:59",
    });
  });

  it("reads a serial exactly, never at 15 digits first", () => {
    // Rounded to 15 digits this would be 45716.6480606713, 0.12 ms less.
    expect(serialDateTime("45716.6480606713012", false)?.time).toBe("15:33:12");
    expect(serialDateTime("4.5716648060671301E4", false)?.time).toBe(
      "15:33:12",
    );
  });

  it("refuses serials before 1 March 1900, past 9999 or below zero", () => {
    expect(serialDateTime("60", false)).toBeNull();
    expect(serialDateTime("61", false)?.date).toBe("1900-03-01");
    expect(serialDateTime("2958465", false)?.date).toBe("9999-12-31");
    expect(serialDateTime("2958466", false)).toBeNull();
    expect(serialDateTime("0", true)?.date).toBe("1904-01-01");
    expect(serialDateTime("-0", true)?.date).toBe("1904-01-01");
    expect(serialDateTime("-1", true)).toBeNull();
    expect(serialDateTime("x", false)).toBeNull();
    expect(serialDateTime("1E99999", false)).toBeNull();
  });
});

describe("serialDate", () => {
  it("takes a whole day, to within a millisecond", () => {
    expect(serialDate("45953", false)).toBe("2025-10-23");
    // 0.99 ms after midnight, and 0.86 ms before the next.
    expect(serialDate("45953.0000000115", false)).toBe("2025-10-23");
    expect(serialDate("45953.99999999", false)).toBe("2025-10-24");
  });

  it("refuses a serial with a time of day in it", () => {
    expect(serialDate("45953.5", false)).toBeNull();
    expect(serialDate("45953.0000001", false)).toBeNull();
  });
});
