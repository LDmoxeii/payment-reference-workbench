import { describe, expect, it } from "vitest";
import { createMoney, decimalToMinor, minorToDecimal, minorToSafeInteger, subtractMoney } from "./money";

describe("exact money helpers", () => {
  it("converts decimals without floating point", () => {
    expect(decimalToMinor("001.20", "CNY")).toBe("120");
    expect(decimalToMinor("-0.01", "CNY")).toBe("-1");
    expect(minorToDecimal("900719925474099312345", "CNY")).toBe("9007199254740993123.45");
  });

  it("rejects invalid precision and unsafe WOW values", () => {
    expect(() => decimalToMinor("1.001", "CNY")).toThrow("at most 2");
    expect(() => minorToSafeInteger("9007199254740992")).toThrow("Long-safe");
  });

  it("subtracts refund facts with BigInt", () => {
    expect(subtractMoney(createMoney("CNY", "100000000000000000001"), createMoney("CNY", "2"), createMoney("CNY", "3")))
      .toEqual(createMoney("CNY", "99999999999999999996"));
  });
});
