import { describe, expect, it } from "vitest";

import { Decimal, MAX_DECIMAL_LENGTH } from "./decimal.js";

const d = (text: string) => Decimal.parse(text);

describe("Decimal.parse", () => {
  it("reads plain decimal strings exactly, beyond float precision", () => {
    expect(d("12345678901234567.125").toString()).toBe("12345678901234567.125");
    expect(d("0.1").plus(d("0.2")).toString()).toBe("0.3");
    expect(d("-0.5").toString()).toBe("-0.5");
    expect(d("007.50").toString()).toBe("7.5");
  });

  it("refuses anything that is not a plain decimal", () => {
    for (const bad of [
      "",
      "1e3",
      "1,5",
      "1.234,56",
      " 1",
      "1.",
      ".5",
      "+1",
      "--1",
      "NaN",
      "Infinity",
      "0x10",
    ]) {
      expect(() => d(bad), JSON.stringify(bad)).toThrow(RangeError);
    }
  });

  it("never repeats the refused text, which may be personal data", () => {
    expect(() => d("Janez Novak")).toThrow(/^Not a plain decimal string$/);
  });

  it("refuses absurdly long input instead of crunching it", () => {
    expect(() => d("1".repeat(MAX_DECIMAL_LENGTH + 1))).toThrow(/longer than/);
    expect(d("9".repeat(MAX_DECIMAL_LENGTH)).isPositive()).toBe(true);
  });
});

describe("Decimal.fromInteger", () => {
  it("accepts safe integers and BigInts, never floats", () => {
    expect(Decimal.fromInteger(4).toString()).toBe("4");
    expect(Decimal.fromInteger(-10n).toString()).toBe("-10");
    expect(() => Decimal.fromInteger(0.5)).toThrow(RangeError);
    expect(() => Decimal.fromInteger(2 ** 53)).toThrow(RangeError);
  });

  it("does not repeat the refused value in its error", () => {
    expect(() => Decimal.fromInteger(1234.5)).toThrow(/^Not a safe integer$/);
  });
});

describe("Decimal hardening", () => {
  it("cannot be built around its checks", () => {
    const Raw = Decimal as unknown as new (num: bigint, den: bigint) => Decimal;
    expect(() => new Raw(1n, -2n)).toThrow(TypeError);
    expect(() => Decimal.fromInteger("12" as never)).toThrow(
      /^Not a safe integer$/,
    );
    expect(() => Decimal.parse(1.5 as never)).toThrow(
      /^Not a plain decimal string$/,
    );
  });

  it("keeps its methods and shared values from being patched", () => {
    expect(Object.isFrozen(Decimal.prototype)).toBe(true);
    expect(Object.isFrozen(Decimal.ZERO)).toBe(true);
    expect(() => {
      (Decimal.ZERO as unknown as { plus: unknown }).plus = () => Decimal.ONE;
    }).toThrow(TypeError);
  });

  it("writes long runs of zeros in linear time", () => {
    const tiny = Decimal.parse(`0.${"0".repeat(60)}1`);
    const started = Date.now();
    for (let i = 0; i < 200; i += 1) tiny.toPlain(100, "down");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(Decimal.parse("10.500").toPlain(3, "down")).toBe("10.5");
    expect(Decimal.parse("0.000").toPlain(3, "down")).toBe("0");
  });
});

describe("Decimal constants", () => {
  it("cannot be replaced at run time", () => {
    expect(Object.isFrozen(Decimal)).toBe(true);
    expect(() => {
      (Decimal as unknown as { ZERO: Decimal }).ZERO = Decimal.ONE;
    }).toThrow(TypeError);
    expect(Decimal.ZERO.isZero()).toBe(true);
  });
});

describe("arithmetic", () => {
  it("stays exact through a division by a Banka Slovenije rate", () => {
    // 45 AAPL sold at USD 214.87 on 2026-03-12, BSI USD 1.1547.
    const perUnit = d("214.87").dividedBy(d("1.1547"));
    expect(perUnit.toFixed(8, "halfUp")).toBe("186.08296527");
    // Multiplying back gives the exact price, which a rounded value would not.
    expect(perUnit.times(d("1.1547")).equals(d("214.87"))).toBe(true);
  });

  it("adds, subtracts, multiplies and compares", () => {
    expect(d("1.10").minus(d("2.2")).toString()).toBe("-1.1");
    expect(d("2.5").times(d("-4")).toString()).toBe("-10");
    expect(Decimal.sum([d("0.1"), d("0.2"), d("0.3")]).toString()).toBe("0.6");
    expect(d("1.50").compare(d("1.5"))).toBe(0);
    expect(d("1.50").equals(d("1.5"))).toBe(true);
    expect(d("-1").lessThan(d("0"))).toBe(true);
    expect(d("3").greaterThan(d("2.999999999"))).toBe(true);
    expect(d("-3").abs().toString()).toBe("3");
    expect(d("0").negated().isZero()).toBe(true);
  });

  it("refuses to divide by zero", () => {
    expect(() => d("1").dividedBy(Decimal.ZERO)).toThrow(/zero/);
  });
});

describe("rounding at a field's scale", () => {
  it("rounds half away from zero in halfUp mode", () => {
    expect(d("2.345").toFixed(2, "halfUp")).toBe("2.35");
    expect(d("-2.345").toFixed(2, "halfUp")).toBe("-2.35");
    expect(d("2.3449999").toFixed(2, "halfUp")).toBe("2.34");
    expect(d("0.005").toFixed(2, "halfUp")).toBe("0.01");
  });

  it("truncates toward zero in down mode", () => {
    expect(d("2.349").toFixed(2, "down")).toBe("2.34");
    expect(d("-2.349").toFixed(2, "down")).toBe("-2.34");
  });

  it("never writes a negative zero", () => {
    expect(d("-0.001").toFixed(2, "halfUp")).toBe("0.00");
    expect(d("-0.001").toPlain(2, "halfUp")).toBe("0");
  });

  it("writes fixed amounts with every decimal and plain values without trailing zeros", () => {
    expect(d("22.2").toFixed(2, "halfUp")).toBe("22.20");
    expect(d("10").toPlain(8, "halfUp")).toBe("10");
    expect(d("0.50").toPlain(8, "halfUp")).toBe("0.5");
    expect(d("1").dividedBy(d("3")).toPlain(8, "halfUp")).toBe("0.33333333");
  });

  it("knows whether a value fits a scale without rounding", () => {
    expect(d("0.1234567891").isExactAt(8)).toBe(false);
    expect(d("0.12345678").isExactAt(8)).toBe(true);
    expect(d("1").dividedBy(d("3")).isExactAt(20)).toBe(false);
    expect(d("1.5").round(0, "halfUp").toString()).toBe("2");
  });

  it("refuses a value with no finite expansion until it is rounded", () => {
    expect(() => d("1").dividedBy(d("3")).toString()).toThrow(/round/);
  });

  it("refuses a scale that is not a small whole number", () => {
    expect(() => d("1").toFixed(-1, "halfUp")).toThrow(RangeError);
    expect(() => d("1").toFixed(2.5, "halfUp")).toThrow(RangeError);
  });
});
