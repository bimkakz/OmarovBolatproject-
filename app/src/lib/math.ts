export function estimateDepositShares(
  amount: bigint,
  totalTokens: bigint,
  totalShares: bigint
): bigint {
  if (totalShares === 0n) {
    return amount;
  }
  if (totalTokens === 0n) {
    return 0n;
  }
  return (amount * totalShares) / totalTokens;
}

export function estimateWithdrawTokens(
  shares: bigint,
  totalTokens: bigint,
  totalShares: bigint
): bigint {
  if (totalShares === 0n) {
    return 0n;
  }
  return (shares * totalTokens) / totalShares;
}

export function estimateShareValue(
  shares: bigint,
  totalTokens: bigint,
  totalShares: bigint
): bigint {
  return estimateWithdrawTokens(shares, totalTokens, totalShares);
}
