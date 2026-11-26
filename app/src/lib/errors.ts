const contractMessages: Record<string, string> = {
  InMarket:
    "Деньги vault сейчас в рынке. Внесение и вывод временно недоступны.",
  ZeroAmount: "Укажите сумму больше нуля.",
  SharesTooSmall: "Слишком мало: за эту сумму вы получите 0 shares.",
  MathOverflow: "Сумма слишком большая для обработки контрактом.",
  WithdrawTooSmall:
    "Слишком мало: за это количество shares вы получите 0 TOKEN_A.",
  VaultEmpty: "В vault пока нет shares.",
  InsufficientCardShares: "На вашей карточке недостаточно shares.",
  Unauthorized: "Эта операция доступна только администратору.",
  WrongPool: "Операция отменена: пул не соответствует токенам этого vault.",
  TokenBNotZero: "Сначала необходимо вернуть все TOKEN_B в vault.",
  PairTokenAlreadyAdded: "Токен пары уже добавлен.",
  PairTokenNotAdded: "Для этого vault ещё не добавлен второй токен пары.",
  PositionAlreadyOpen: "В vault уже открыта позиция.",
  NoOpenPosition: "У vault нет такой открытой позиции.",
  PositionOpen: "Сначала закройте позицию, затем синхронизируйте vault.",
};

const walletMessages: Record<string, string> = {
  WalletNotFound:
    "Phantom не найден. Установите расширение Phantom или используйте тестовый кошелёк в dev-режиме.",
  WalletRejected: "Подписание отклонено в кошельке.",
  WalletLocked: "Разблокируйте Phantom и повторите попытку.",
  WalletDisconnected: "Кошелёк отключён. Подключите его снова.",
};

export function getErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    Object.prototype.hasOwnProperty.call(walletMessages, error.name)
  ) {
    return walletMessages[error.name];
  }

  const message = error instanceof Error ? error.message : String(error);
  const contractName = Object.keys(contractMessages).find(
    (name) =>
      message.includes(name) ||
      message.includes(
        name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
      )
  );
  if (contractName) {
    return contractMessages[contractName];
  }

  if (/user rejected|rejected the request|approval denied/i.test(message)) {
    return walletMessages.WalletRejected;
  }
  if (/not connected|disconnected/i.test(message)) {
    return walletMessages.WalletDisconnected;
  }
  if (/failed to fetch|network error|rpc/i.test(message)) {
    return "Не удалось связаться с devnet RPC. Проверьте подключение и VITE_RPC_URL.";
  }
  return message || "Не удалось выполнить операцию.";
}
