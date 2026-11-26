import { describe, expect, it } from "vitest";
import {
  estimateDepositShares,
  estimateShareValue,
  estimateWithdrawTokens,
} from "./math";

describe("vault share estimates", () => {
  it("issues first shares 1:1 and then follows the contract integer formula", () => {
    expect(estimateDepositShares(5_000_000n, 0n, 0n)).toBe(5_000_000n);
    expect(estimateDepositShares(5_000_000n, 20_000_000n, 10_000_000n)).toBe(
      2_500_000n
    );
    expect(estimateDepositShares(1n, 3n, 2n)).toBe(0n);
  });

  it("estimates withdrawals using integer division", () => {
    expect(estimateWithdrawTokens(2_500_000n, 20_000_000n, 10_000_000n)).toBe(
      5_000_000n
    );
    expect(estimateWithdrawTokens(1n, 1n, 2n)).toBe(0n);
    expect(estimateWithdrawTokens(1n, 10n, 0n)).toBe(0n);
  });

  it("values the user's shares in TOKEN_A", () => {
    expect(estimateShareValue(4_000_000n, 12_000_000n, 8_000_000n)).toBe(
      6_000_000n
    );
  });
});
