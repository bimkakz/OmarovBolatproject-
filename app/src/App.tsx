import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";
import { formatAmount, formatRatio, parseAmount } from "./lib/amount";
import {
  estimateDepositShares,
  estimateShareValue,
  estimateWithdrawTokens,
} from "./lib/math";
import { getErrorMessage } from "./lib/errors";
import { getRpcUrl } from "./lib/network";
import {
  createCard,
  deposit,
  fetchVaultSummary,
  fetchVaultSnapshot,
  getVaultClient,
  withdraw,
  type VaultClient,
  type VaultSnapshot,
  type VaultSummary,
} from "./lib/vault";
import {
  connectPhantom,
  getDevelopmentWallet,
  type SolanaWallet,
} from "./lib/wallet";

type WalletKind = "phantom" | "development";
type Action = "create-card" | "deposit" | "withdraw";

const connection = new Connection(getRpcUrl(), "confirmed");

function shortAddress(address: PublicKey): string {
  const value = address.toBase58();
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function App() {
  const [wallet, setWallet] = useState<SolanaWallet>();
  const [walletKind, setWalletKind] = useState<WalletKind>();
  const [client, setClient] = useState<VaultClient>();
  const [snapshot, setSnapshot] = useState<VaultSnapshot>();
  const [vaultSummary, setVaultSummary] = useState<VaultSummary>();
  const [depositValue, setDepositValue] = useState("");
  const [withdrawValue, setWithdrawValue] = useState("");
  const [activeAction, setActiveAction] = useState<Action>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const summary = await fetchVaultSummary(connection);
    setVaultSummary(summary);
    if (wallet && client) {
      const freshSnapshot = await fetchVaultSnapshot(client, wallet);
      setSnapshot(freshSnapshot);
    } else {
      setSnapshot(undefined);
    }
  }, [client, wallet]);

  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        if (active) {
          setError("");
        }
        await refresh();
      } catch (reason) {
        if (active) {
          setError(getErrorMessage(reason));
        }
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const connect = useCallback(async (kind: WalletKind) => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const nextWallet =
        kind === "phantom" ? await connectPhantom() : getDevelopmentWallet();
      const nextClient = getVaultClient(connection, nextWallet);
      await connection.getGenesisHash().then((genesisHash) => {
        if (genesisHash !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1") {
          throw new Error(
            "RPC должен указывать на Solana devnet. Проверьте VITE_RPC_URL."
          );
        }
      });
      setWallet(nextWallet);
      setWalletKind(kind);
      setClient(nextClient);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (walletKind === "phantom") {
      void window.phantom?.solana?.disconnect().catch((reason: unknown) => {
        setError(getErrorMessage(reason));
      });
    }
    setWallet(undefined);
    setWalletKind(undefined);
    setClient(undefined);
    setSnapshot(undefined);
    setDepositValue("");
    setWithdrawValue("");
  }, [walletKind]);

  const decimals = 6;
  const parsedDeposit = useMemo(() => {
    try {
      return depositValue ? parseAmount(depositValue, decimals) : undefined;
    } catch {
      return undefined;
    }
  }, [depositValue]);
  const parsedWithdraw = useMemo(() => {
    try {
      return withdrawValue ? parseAmount(withdrawValue, decimals) : undefined;
    } catch {
      return undefined;
    }
  }, [withdrawValue]);
  const estimatedShares =
    vaultSummary && parsedDeposit !== undefined
      ? estimateDepositShares(
          parsedDeposit,
          vaultSummary.totalTokens,
          vaultSummary.totalShares
        )
      : undefined;
  const estimatedTokens =
    vaultSummary && parsedWithdraw !== undefined
      ? estimateWithdrawTokens(
          parsedWithdraw,
          vaultSummary.totalTokens,
          vaultSummary.totalShares
        )
      : undefined;
  const depositError =
    depositValue && parsedDeposit === undefined
      ? "Введите корректную сумму (не более 6 знаков после запятой)."
      : parsedDeposit !== undefined &&
        snapshot &&
        parsedDeposit > snapshot.tokenBalance
      ? `У вас только ${formatAmount(snapshot.tokenBalance, decimals)} TOKEN_A`
      : estimatedShares === 0n
      ? "Слишком мало: за эту сумму вы получите 0"
      : "";
  const withdrawError =
    withdrawValue && parsedWithdraw === undefined
      ? "Введите корректное количество shares (не более 6 знаков после запятой)."
      : parsedWithdraw !== undefined &&
        snapshot &&
        parsedWithdraw > snapshot.shareBalance
      ? `У вас только ${formatAmount(snapshot.shareBalance, decimals)} shares`
      : estimatedTokens === 0n
      ? "Слишком мало: за это количество shares вы получите 0 TOKEN_A"
      : "";

  const doAction = async (action: Action) => {
    if (!client || !snapshot) {
      return;
    }
    setActiveAction(action);
    setError("");
    setNotice("");
    try {
      let signature: string;
      if (action === "create-card") {
        signature = await createCard(client);
        setNotice("Карточка создана.");
      } else if (action === "deposit" && parsedDeposit !== undefined) {
        signature = await deposit(client, parsedDeposit);
        setNotice("Внесение выполнено.");
        setDepositValue("");
      } else if (action === "withdraw" && parsedWithdraw !== undefined) {
        signature = await withdraw(client, parsedWithdraw);
        setNotice("Вывод выполнен.");
        setWithdrawValue("");
      } else {
        return;
      }
      setNotice(
        (current) => `${current} Транзакция: ${signature.slice(0, 8)}…`
      );
      await refresh();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setActiveAction(undefined);
    }
  };

  const shareValue =
    vaultSummary && vaultSummary.totalShares > 0n
      ? formatRatio(vaultSummary.totalTokens, vaultSummary.totalShares)
      : "1";
  const sharesWorth =
    snapshot && vaultSummary && vaultSummary.totalShares > 0n
      ? estimateShareValue(
          snapshot.shareBalance,
          vaultSummary.totalTokens,
          vaultSummary.totalShares
        )
      : 0n;
  const totalWorth = (snapshot?.tokenBalance ?? 0n) + sharesWorth;

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Vault home">
          <span className="brand-mark">V</span>
          <span>
            vault<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="network-pill">
          <span /> Solana Devnet
        </div>
        {wallet ? (
          <button className="wallet-button connected" onClick={disconnect}>
            <span className="connected-dot" />
            {shortAddress(wallet.publicKey)}
            <span className="disconnect-label">Отключить</span>
          </button>
        ) : (
          <div className="wallet-actions">
            <button
              className="wallet-button"
              onClick={() => void connect("phantom")}
              disabled={loading}
            >
              Подключить Phantom
            </button>
            {import.meta.env.DEV && (
              <button
                className="wallet-button test-wallet"
                onClick={() => void connect("development")}
                disabled={loading}
              >
                Тестовый кошелёк
              </button>
            )}
          </div>
        )}
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-line" /> VAULT НА SOLANA
          </p>
          <h1>
            Ваши токены.
            <br />
            <span>Одна общая позиция.</span>
          </h1>
          <p className="hero-description">
            Вносите TOKEN_A в vault и получайте shares. Стоимость доли следует
            за результатом vault.
          </p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">
            <span>V</span>
          </div>
          <span className="orbit-token token-top">A</span>
          <span className="orbit-token token-bottom">S</span>
        </div>
      </section>

      {error && (
        <div className="alert error-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success-alert" role="status">
          {notice}
        </div>
      )}

      <section className="overview-grid" aria-label="Состояние vault">
        <article className="overview-card main-stat">
          <div className="card-heading">
            <span>Общая стоимость vault</span>
            <span className="live-tag">
              <i /> DEVNET
            </span>
          </div>
          <div className="big-number">
            {vaultSummary
              ? formatAmount(vaultSummary.totalTokens, decimals)
              : "—"}
            <span>TOKEN_A</span>
          </div>
          <div className="stat-foot">
            <span>Всего shares</span>
            <strong>
              {vaultSummary
                ? formatAmount(vaultSummary.totalShares, decimals)
                : "—"}
            </strong>
          </div>
        </article>
        <article className="overview-card">
          <div className="card-heading">
            <span>Цена одного share</span>
            <span
              className="info-mark"
              title="По данным total_tokens и total_shares"
            >
              i
            </span>
          </div>
          <div className="metric-number">{vaultSummary ? shareValue : "—"}</div>
          <div className="metric-caption">TOKEN_A за share</div>
          <div
            className={`mode-badge ${
              vaultSummary?.inMarket ? "in-market" : ""
            }`}
          >
            <i /> {vaultSummary?.inMarket ? "Деньги в рынке" : "Обычный режим"}
          </div>
        </article>
      </section>

      <section className="account-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
            <h2>Мой счёт</h2>
          </div>
          {wallet && (
            <button className="refresh-button" onClick={() => void refresh()}>
              Обновить ↻
            </button>
          )}
        </div>
        {!wallet ? (
          <div className="connect-prompt">
            <div className="prompt-icon">↗</div>
            <div>
              <strong>Подключите кошелёк</strong>
              <p>Чтобы увидеть балансы и управлять shares.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="balance-grid">
              <BalanceCard
                label="Баланс SOL"
                amount={
                  snapshot
                    ? formatAmount(snapshot.solBalance, LAMPORTS_PER_SOL, 4)
                    : "—"
                }
                unit="SOL"
                hint="Баланс кошелька"
              />
              <BalanceCard
                label="Баланс TOKEN_A"
                amount={
                  snapshot ? formatAmount(snapshot.tokenBalance, decimals) : "—"
                }
                unit="TOKEN_A"
                hint="Доступно для внесения"
              />
              <BalanceCard
                label="Мои shares"
                amount={
                  snapshot ? formatAmount(snapshot.shareBalance, decimals) : "—"
                }
                unit="SHARES"
                hint={
                  snapshot
                    ? `≈ ${formatAmount(sharesWorth, decimals)} TOKEN_A`
                    : "Доля в vault"
                }
                accent
              />
            </div>
            <div className="portfolio-strip">
              <span>Оценочная стоимость моей позиции</span>
              <strong>
                ≈ {snapshot ? formatAmount(totalWorth, decimals) : "—"}{" "}
                <small>TOKEN_A</small>
              </strong>
            </div>
            {!snapshot?.userCardExists && (
              <div className="card-create-row">
                <div>
                  <strong>Начните с пользовательской карточки</strong>
                  <p>
                    Она создаётся один раз и привязывается к вашему кошельку.
                  </p>
                </div>
                <button
                  className="primary-button compact"
                  onClick={() => void doAction("create-card")}
                  disabled={!!activeAction}
                >
                  {activeAction === "create-card"
                    ? "Создаём…"
                    : "Создать карточку"}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="actions-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">УПРАВЛЕНИЕ ДОЛЕЙ</p>
            <h2>Внести или вывести</h2>
          </div>
          {vaultSummary?.inMarket && (
            <span className="market-label">
              <i /> Операции приостановлены
            </span>
          )}
        </div>
        {vaultSummary?.inMarket && (
          <div className="market-notice">
            <span className="notice-icon">!</span>
            <p>
              <strong>Средства vault находятся в рынке.</strong> Внесение и
              вывод временно отключены, пока администратор не вернёт средства и
              не синхронизирует vault.
            </p>
          </div>
        )}
        <div className="action-grid">
          <article className="action-card">
            <div className="action-card-heading">
              <span className="action-icon deposit-icon">↓</span>
              <div>
                <h3>Внести токены</h3>
                <p>Обменяйте TOKEN_A на долю в vault.</p>
              </div>
            </div>
            <label htmlFor="deposit-amount">
              Сумма <span>TOKEN_A</span>
            </label>
            <input
              id="deposit-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={depositValue}
              onChange={(event) => setDepositValue(event.target.value)}
            />
            <div className="estimate-line">
              Получите{" "}
              <strong>
                ≈{" "}
                {estimatedShares === undefined
                  ? "—"
                  : formatAmount(estimatedShares, decimals)}{" "}
                shares
              </strong>
            </div>
            {depositError && <p className="field-error">{depositError}</p>}
            <button
              className="primary-button"
              onClick={() => void doAction("deposit")}
              disabled={
                !wallet ||
                !snapshot?.userCardExists ||
                !!vaultSummary?.inMarket ||
                !!activeAction ||
                parsedDeposit === undefined ||
                parsedDeposit <= 0n ||
                !!depositError
              }
            >
              {activeAction === "deposit" ? "Отправляем…" : "Внести TOKEN_A"}
            </button>
          </article>
          <article className="action-card">
            <div className="action-card-heading">
              <span className="action-icon withdraw-icon">↑</span>
              <div>
                <h3>Вывести токены</h3>
                <p>Сожгите shares и получите TOKEN_A.</p>
              </div>
            </div>
            <label htmlFor="withdraw-amount">
              Количество <span>SHARES</span>
            </label>
            <input
              id="withdraw-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={withdrawValue}
              onChange={(event) => setWithdrawValue(event.target.value)}
            />
            <div className="estimate-line">
              Получите{" "}
              <strong>
                ≈{" "}
                {estimatedTokens === undefined
                  ? "—"
                  : formatAmount(estimatedTokens, decimals)}{" "}
                TOKEN_A
              </strong>
            </div>
            {withdrawError && <p className="field-error">{withdrawError}</p>}
            <button
              className="secondary-button"
              onClick={() => void doAction("withdraw")}
              disabled={
                !wallet ||
                !snapshot?.userCardExists ||
                !!vaultSummary?.inMarket ||
                !!activeAction ||
                parsedWithdraw === undefined ||
                parsedWithdraw <= 0n ||
                !!withdrawError
              }
            >
              {activeAction === "withdraw" ? "Отправляем…" : "Вывести TOKEN_A"}
            </button>
          </article>
        </div>
        {snapshot && !snapshot.userCardExists && wallet && (
          <p className="action-footnote">
            Сначала создайте карточку, чтобы внести или вывести долю.
          </p>
        )}
      </section>

      <footer className="footer">
        <span>Учебный MVP · Solana devnet</span>
        <a
          href={`https://explorer.solana.com/address/${
            client?.vaultState.toBase58() ?? ""
          }?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          Открыть vault в Explorer ↗
        </a>
      </footer>
    </main>
  );
}

function BalanceCard({
  label,
  amount,
  unit,
  hint,
  accent = false,
}: {
  label: string;
  amount: string;
  unit: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <article className={`balance-card ${accent ? "balance-accent" : ""}`}>
      <span className="balance-label">{label}</span>
      <div className="balance-amount">
        {amount}
        <small>{unit}</small>
      </div>
      <span className="balance-hint">{hint}</span>
    </article>
  );
}

export default App;
