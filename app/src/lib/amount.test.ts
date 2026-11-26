import { describe, expect, it } from "vitest";
import { formatAmount, formatRatio, parseAmount } from "./amount";

describe("amount conversion", () => {
  it("parses decimal amounts to bigint without floating point", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount("9007199254740993.000001", 6)).toBe(
      9_007_199_254_740_993_000_001n
    );
  });

  it("formats bigint values without losing precision", () => {
    expect(formatAmount(1_500_000n, 6)).toBe("1,5");
    expect(formatAmount(9_007_199_254_740_993_000_001n, 6)).toBe(
      "9 007 199 254 740 993,000001"
    );
    expect(formatRatio(3n, 2n)).toBe("1,5");
  });

  it("rejects malformed, negative, and over-precise amounts", () => {
    expect(() => parseAmount("-1", 6)).toThrow();
    expect(() => parseAmount("1e3", 6)).toThrow();
    expect(() => parseAmount("1,5", 6)).toThrow();
    expect(() => parseAmount("1.0000001", 6)).toThrow();
  });
});
