export function parseAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Количество знаков после запятой должно быть целым числом");
  }

  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d*))?$/.exec(normalized);
  if (!match) {
    throw new Error("Введите неотрицательную сумму цифрами");
  }

  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`Допустимо не более ${decimals} знаков после запятой`);
  }

  const scale = 10n ** BigInt(decimals);
  return (
    BigInt(match[1]) * scale +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

export function formatAmount(
  value: bigint,
  decimals: number,
  precision = decimals
): string {
  if (value < 0n) {
    return `-${formatAmount(-value, decimals, precision)}`;
  }

  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const shownPrecision = Math.max(0, Math.min(decimals, precision));
  if (shownPrecision === 0) {
    return whole;
  }

  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, shownPrecision)
    .replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : whole;
}

export function formatRatio(
  numerator: bigint,
  denominator: bigint,
  precision = 6
): string {
  if (denominator === 0n) {
    return "0";
  }

  const scale = 10n ** BigInt(precision);
  const scaled = (numerator * scale) / denominator;
  return formatAmount(scaled, precision, precision);
}
