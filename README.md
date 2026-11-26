# Solana Vault & Raydium CLMM Pool Project

Учебный проект на Solana (Anchor 0.31.1) с реализацией хранилища (Vault) и интеграцией с Raydium CLMM на devnet.

## Структура проекта

- `programs/vault`: Anchor смарт-контракт хранилища:
  - `initialize_vault`: инициализация хранилища (vault_state PDA, vault_token_account PDA, share_mint PDA).
  - `create_user_card`: создание персональной карточки пользователя (`user_card` PDA).
  - `deposit`: внесение токенов в хранилище с расчётом и выпуском share-токенов.
  - `withdraw`: вывод токенов из хранилища со сжиганием shares (CPI burn & transfer).
- `programs/vault/src/raydium.rs`: CPI-обёртка для Raydium CLMM swap_v2 (devnet).
- `tests/vault.ts`: полный набор тестов для контракта Vault.
- `scripts/create-clmm-pool.ts`: скрипт создания тестовых токенов и пула ликвидности Raydium CLMM на devnet.

---

## Неделя 11: Создание CLMM-пула на Raydium devnet

### 1. Подготовка окружения
Для выполнения транзакций на devnet требуется:
1. Переключить CLI на сеть **devnet**:
   ```bash
   solana config set --url devnet
   ```
2. Убедиться, что на балансе кошелька есть **~1 SOL** для оплаты rent-exempt аккаунтов и комиссий сети:
   ```bash
   solana airdrop 1
   # или проверить баланс:
   solana balance
   ```

### 2. Запуск скрипта создания пула
Запуск осуществляется командой:
```bash
yarn create-pool
# или:
npm run create-pool
```

Переменные окружения (опционально):
- `ANCHOR_WALLET`: путь к файлу приватного ключа кошелька (по умолчанию `~/.config/solana/id.json`).
- `DEVNET_RPC`: URL devnet RPC (по умолчанию `https://api.devnet.solana.com`).

Скрипт выполняет следующие шаги:
1. **[1/3] Создаю тестовые токены...**
   - Создает `TOKEN_A` и `TOKEN_B` (по 6 decimals).
   - Минтит по 1 000 000 каждого токена на кошелёк пользователя.
2. **[2/3] Создаю CLMM-пул на Raydium devnet...**
   - Получает через API Raydium конфигурацию комиссий (шаг тика 60, комиссия 0.25%).
   - Инициализирует пул TOKEN_A / TOKEN_B в программе Raydium CLMM (`DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH`) со стартовой ценой 1 (1 TOKEN_A = 1 TOKEN_B).
   - Выводит адрес созданного пула и ссылку на транзакцию в Solana Explorer (cluster=devnet).
3. **[3/3] Сохраняю devnet-pool.json**
   - Сохраняет адреса токенов, `poolId`, `txId` и ссылки в локальный файл `devnet-pool.json` (добавлен в `.gitignore`).

### 3. Что сдавать на проверку
- Ссылку на коммит в GitHub репозитории.
- Сгенерированный `poolId` со ссылкой на Solana Explorer (`https://explorer.solana.com/address/<poolId>?cluster=devnet`).

---

## Неделя 12: Vault и Raydium CLMM на devnet

- Администратор один раз добавляет TOKEN_B; его vault token account использует PDA seeds `["vault_tokens_b", TOKEN_A mint]`.
- Только администратор может добавлять пару, выполнять swaps и синхронизировать vault.
- После swap vault помечается `in_market`; deposit и withdraw приостанавливаются до синхронизации.
- `sync_vault` требует нулевой баланс TOKEN_B, считывает реальный баланс TOKEN_A и сбрасывает `in_market`.
- Swap может принять `u64::MAX`, чтобы обменять весь баланс входного токена на момент исполнения. Передавайте tick arrays как remaining accounts.

Devnet-интеграционные тесты создают свои токены и CLMM-пулы и требуют SOL на кошельке для rent и комиссий:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-mocha -p ./tsconfig.json -t 600000 tests/raydium.ts
```

Для возврата vault в доступное состояние клиент должен отправить `swap(u64::MAX, minOut, false)` с `sync_vault` в `.postInstructions([syncIx])`.

---

## Неделя 13: Открытая позиция Raydium CLMM

- Администратор может открыть одну позицию для пары vault. NFT и `personal_position` записываются в `VaultState`; NFT принадлежит vault PDA.
- Для открытия контракт выдаёт админу ограниченный `approve` на обоих токен-аккаунтах, вызывает Raydium `open_position_v2` и сразу отзывает разрешения.
- Сбор комиссий выполняется `decrease_liquidity_v2` с ликвидностью `0`; закрытие забирает всю ликвидность и комиссии, затем возвращает админу лампорты закрытых Raydium-аккаунтов сверх резерва rent `VaultState`.
- После открытия `in_market` остаётся включённым до закрытия позиции, обмена всего TOKEN_B обратно и `sync_vault`. Синхронизация запрещена, пока позиция открыта или баланс TOKEN_B не нулевой.

Ограничения учебной версии:

- Работает только на devnet; адрес CLMM программы задан feature `devnet`.
- Пул не закрепляется за vault; выбор пула доверен администратору (проверяется только соответствие пары токенов).
- Одновременно разрешена только одна позиция на vault.
- Награды Raydium не собираются; при активных наградах `close_position` может завершиться ошибкой Raydium.
- Тесты недели 13 в `tests/raydium.ts` создают собственные токены и пулы и требуют SOL для rent и транзакционных комиссий.
