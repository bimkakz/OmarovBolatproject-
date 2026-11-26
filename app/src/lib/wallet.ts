import {
  Keypair,
  type PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

const DEV_WALLET_STORAGE_KEY = "vault-demo-wallet-v1";

export interface SolanaWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]>;
}

interface PhantomProvider extends SolanaWallet {
  isPhantom?: boolean;
  connect(options?: {
    onlyIfTrusted?: boolean;
  }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  on?(event: string, callback: (...args: unknown[]) => void): void;
  off?(event: string, callback: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

export function getPhantomProvider(): PhantomProvider {
  const provider = window.phantom?.solana;
  if (!provider?.isPhantom) {
    const error = new Error("Phantom wallet extension not found");
    error.name = "WalletNotFound";
    throw error;
  }
  return provider;
}

export async function connectPhantom(): Promise<PhantomProvider> {
  const provider = getPhantomProvider();
  try {
    await provider.connect();
    return provider;
  } catch (error) {
    if (error instanceof Error && /reject/i.test(error.message)) {
      error.name = "WalletRejected";
    }
    throw error;
  }
}

export function getDevelopmentWallet(): SolanaWallet {
  if (!import.meta.env.DEV) {
    throw new Error("Тестовый кошелёк доступен только в режиме разработки.");
  }

  const storedSecret = localStorage.getItem(DEV_WALLET_STORAGE_KEY);
  let keypair: Keypair;
  if (storedSecret) {
    let secret: unknown;
    try {
      secret = JSON.parse(storedSecret);
    } catch {
      throw new Error(
        "Не удалось прочитать тестовый ключ из localStorage. Очистите данные сайта."
      );
    }
    if (!Array.isArray(secret) || !secret.every(Number.isInteger)) {
      throw new Error(
        "Тестовый ключ в localStorage повреждён. Очистите данные сайта."
      );
    }
    try {
      keypair = Keypair.fromSecretKey(Uint8Array.from(secret as number[]));
    } catch {
      throw new Error(
        "Тестовый ключ в localStorage повреждён. Очистите данные сайта."
      );
    }
  } else {
    keypair = Keypair.generate();
    localStorage.setItem(
      DEV_WALLET_STORAGE_KEY,
      JSON.stringify(Array.from(keypair.secretKey))
    );
  }

  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      transaction: T
    ) => {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([keypair]);
      } else {
        transaction.partialSign(keypair);
      }
      return transaction;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      transactions: T[]
    ) =>
      Promise.all(
        transactions.map(async (transaction) => {
          if (transaction instanceof VersionedTransaction) {
            transaction.sign([keypair]);
          } else {
            transaction.partialSign(keypair);
          }
          return transaction;
        })
      ),
  };
}
