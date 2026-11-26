import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./errors";

describe("friendly wallet and contract errors", () => {
  it("maps contract failures to Russian explanations", () => {
    expect(getErrorMessage(new Error("AnchorError: InMarket"))).toContain(
      "Деньги vault сейчас в рынке"
    );
    expect(getErrorMessage(new Error("custom program error: ZeroAmount"))).toBe(
      "Укажите сумму больше нуля."
    );
    expect(getErrorMessage(new Error("SharesTooSmall"))).toContain(
      "вы получите 0 shares"
    );
  });

  it("maps wallet failures and preserves useful unknown errors", () => {
    const missingWallet = new Error("not installed");
    missingWallet.name = "WalletNotFound";
    expect(getErrorMessage(missingWallet)).toContain("Phantom не найден");
    expect(getErrorMessage(new Error("user rejected the request"))).toBe(
      "Подписание отклонено в кошельке."
    );
    expect(getErrorMessage(new Error("custom failure"))).toBe("custom failure");
  });
});
