# Solana Vault & Raydium CLMM Pool Project

Учебный проект на Solana (Anchor 0.31.1) с реализацией хранилища (Vault) и интеграцией с Raydium CLMM на devnet.

## Структура проекта

- `programs/vault`: Anchor смарт-контракт хранилища:
  - `initialize_vault`: инициализация хранилища (vault_state PDA, vault_token_account PDA, share_mint PDA).
  - `create_user_card`: создание персональной карточки пользователя (`user_card` PDA).
  - `deposit`: внесение токенов в хранилище с расчётом и выпуском share-токенов.
  - `withdraw`: вывод токенов из хранилища со сжиганием shares (CPI burn & transfer).
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
