import { describe, expect, it } from "vitest";
import { money } from "./shared";

describe("Money wire contract", () => {
  it("preserves arbitrary precision decimal strings", () => {
    expect(money({ currency: "CNY", amountMinor: "900719925474099312345" })).toEqual({
      currency: "CNY",
      amountMinor: "900719925474099312345",
    });
  });

  it("rejects JSON numbers before they can masquerade as precise minor units", () => {
    expect(() => money({ currency: "CNY", amountMinor: 9_007_199_254_740_993 })).toThrow(/十进制字符串/);
    expect(() => money(100)).toThrow(/十进制字符串/);
  });
});
