import {
  AnchorProvider,
  BorshAccountsCoder,
  BN,
  Program,
  type Idl,
} from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import idl from "../idl/vault.json";
import type { Vault } from "../idl/vault";
import config from "../vault-config.json";
import type { SolanaWallet } from "./wallet";
import { DEVNET_GENESIS_HASH } from "./network";

export interface VaultSnapshot {
  totalTokens: bigint;
  totalShares: bigint;
  inMarket: boolean;
  tokenMint: PublicKey;
  shareMint: PublicKey;
  vaultTokenAccount: PublicKey;
  userCardExists: boolean;
  cardShares: bigint;
  tokenBalance: bigint;
  shareBalance: bigint;
  solBalance: bigint;
}

export interface VaultSummary {
  totalTokens: bigint;
  totalShares: bigint;
  inMarket: boolean;
}

export interface VaultClient {
  connection: Connection;
  provider: AnchorProvider;
  program: Program<Vault>;
  vaultState: PublicKey;
  tokenMint: PublicKey;
  shareMint: PublicKey;
  vaultTokenAccount: PublicKey;
  userCard: PublicKey;
}

export function getVaultClient(
  connection: Connection,
  wallet: SolanaWallet
): VaultClient {
  if (
    !config.vaultState ||
    !config.tokenMint ||
    !config.shareMint ||
    !config.vaultTokenAccount
  ) {
    throw new Error(
      "Vault ещё не настроен. Сначала администратор должен выполнить yarn setup-demo."
    );
  }

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const vaultState = new PublicKey(config.vaultState);
  const tokenMint = new PublicKey(config.tokenMint);
  const shareMint = new PublicKey(config.shareMint);
  const vaultTokenAccount = new PublicKey(config.vaultTokenAccount);
  const [derivedVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()],
    new PublicKey(idl.address)
  );
  const [derivedTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
    new PublicKey(idl.address)
  );
  const [derivedShareMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), tokenMint.toBuffer()],
    new PublicKey(idl.address)
  );
  if (!derivedVault.equals(vaultState)) {
    throw new Error(
      "Адрес vault в app/src/vault-config.json не соответствует TOKEN_A."
    );
  }
  if (
    !derivedTokenAccount.equals(vaultTokenAccount) ||
    !derivedShareMint.equals(shareMint)
  ) {
    throw new Error(
      "PDA vault token account или share mint не совпадает с конфигурацией."
    );
  }

  const [userCard] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_card"),
      vaultState.toBuffer(),
      wallet.publicKey.toBuffer(),
    ],
    new PublicKey(idl.address)
  );
  return {
    connection,
    provider,
    program: new Program<Vault>(idl as Vault & Idl, provider),
    vaultState,
    tokenMint,
    shareMint,
    vaultTokenAccount,
    userCard,
  };
}

export async function fetchVaultSummary(
  connection: Connection
): Promise<VaultSummary> {
  if (!config.vaultState) {
    throw new Error(
      "Vault ещё не настроен. Сначала администратор должен выполнить yarn setup-demo."
    );
  }
  const vaultState = new PublicKey(config.vaultState);
  const accountInfo = await connection.getAccountInfo(vaultState, "confirmed");
  if (!accountInfo) {
    throw new Error(
      "Аккаунт vault не найден в devnet. Проверьте конфигурацию и запустите yarn setup-demo."
    );
  }
  if (!accountInfo.owner.equals(new PublicKey(idl.address))) {
    throw new Error("Настроенный аккаунт vault принадлежит другой программе.");
  }
  const state = new BorshAccountsCoder(idl as Vault & Idl).decode(
    "VaultState",
    accountInfo.data
  );
  return {
    totalTokens: BigInt(state.total_tokens.toString()),
    totalShares: BigInt(state.total_shares.toString()),
    inMarket: state.in_market,
  };
}

async function getTokenAmount(
  connection: Connection,
  address: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) {
    return 0n;
  }
  const tokenAccount = await getAccount(
    connection,
    address,
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  if (!tokenAccount.owner.equals(owner) || !tokenAccount.mint.equals(mint)) {
    throw new Error(
      `Токен-аккаунт ${address.toBase58()} принадлежит другому владельцу или mint.`
    );
  }
  return tokenAccount.amount;
}

export async function fetchVaultSnapshot(
  client: VaultClient,
  wallet: SolanaWallet
): Promise<VaultSnapshot> {
  const state = await client.program.account.vaultState.fetch(
    client.vaultState
  );
  const userCardInfo = await client.connection.getAccountInfo(
    client.userCard,
    "confirmed"
  );
  const userCard = userCardInfo
    ? await client.program.account.userCard.fetch(client.userCard)
    : undefined;
  const tokenAccount = getAssociatedTokenAddressSync(
    client.tokenMint,
    wallet.publicKey
  );
  const shareAccount = getAssociatedTokenAddressSync(
    client.shareMint,
    wallet.publicKey
  );
  const [tokenBalance, shareBalance, solBalance] = await Promise.all([
    getTokenAmount(
      client.connection,
      tokenAccount,
      wallet.publicKey,
      client.tokenMint
    ),
    getTokenAmount(
      client.connection,
      shareAccount,
      wallet.publicKey,
      client.shareMint
    ),
    client.connection.getBalance(wallet.publicKey, "confirmed"),
  ]);
  return {
    totalTokens: BigInt(state.totalTokens.toString()),
    totalShares: BigInt(state.totalShares.toString()),
    inMarket: state.inMarket,
    tokenMint: client.tokenMint,
    shareMint: client.shareMint,
    vaultTokenAccount: client.vaultTokenAccount,
    userCardExists: userCard !== undefined,
    cardShares: userCard ? BigInt(userCard.shares.toString()) : 0n,
    tokenBalance,
    shareBalance,
    solBalance: BigInt(solBalance),
  };
}

async function assertDevnet(connection: Connection): Promise<void> {
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(
      "Операция отменена: RPC из VITE_RPC_URL должен указывать на Solana devnet."
    );
  }
}

async function send(
  client: VaultClient,
  connection: Connection,
  instructions: TransactionInstruction[]
): Promise<string> {
  await assertDevnet(connection);
  return client.provider.sendAndConfirm(new Transaction().add(...instructions));
}

export async function createCard(client: VaultClient): Promise<string> {
  await assertDevnet(client.connection);
  if (await client.connection.getAccountInfo(client.userCard, "confirmed")) {
    throw new Error("Карточка уже создана для этого кошелька.");
  }
  const instruction = await client.program.methods
    .createUserCard()
    .accountsPartial({
      user: client.provider.wallet.publicKey,
      vaultState: client.vaultState,
      userCard: client.userCard,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return send(client, client.connection, [instruction]);
}

async function maybeCreateAta(
  client: VaultClient,
  address: PublicKey,
  mint: PublicKey
): Promise<TransactionInstruction[]> {
  const info = await client.connection.getAccountInfo(address, "confirmed");
  if (info) {
    await getAccount(client.connection, address, "confirmed", TOKEN_PROGRAM_ID);
    return [];
  }
  return [
    createAssociatedTokenAccountInstruction(
      client.provider.wallet.publicKey,
      address,
      client.provider.wallet.publicKey,
      mint,
      TOKEN_PROGRAM_ID
    ),
  ];
}

export async function deposit(
  client: VaultClient,
  amount: bigint
): Promise<string> {
  const owner = client.provider.wallet.publicKey;
  const userTokenAccount = getAssociatedTokenAddressSync(
    client.tokenMint,
    owner
  );
  const userShareAccount = getAssociatedTokenAddressSync(
    client.shareMint,
    owner
  );
  const instructions = [
    ...(await maybeCreateAta(client, userTokenAccount, client.tokenMint)),
    ...(await maybeCreateAta(client, userShareAccount, client.shareMint)),
  ];
  instructions.push(
    await client.program.methods
      .deposit(new BN(amount.toString()))
      .accountsPartial({
        user: owner,
        vaultState: client.vaultState,
        userCard: client.userCard,
        userTokenAccount,
        vaultTokenAccount: client.vaultTokenAccount,
        shareMint: client.shareMint,
        userShareAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
  );
  return send(client, client.connection, instructions);
}

export async function withdraw(
  client: VaultClient,
  sharesAmount: bigint
): Promise<string> {
  const owner = client.provider.wallet.publicKey;
  const userTokenAccount = getAssociatedTokenAddressSync(
    client.tokenMint,
    owner
  );
  const userShareAccount = getAssociatedTokenAddressSync(
    client.shareMint,
    owner
  );
  const instructions = [
    ...(await maybeCreateAta(client, userTokenAccount, client.tokenMint)),
    ...(await maybeCreateAta(client, userShareAccount, client.shareMint)),
  ];
  instructions.push(
    await client.program.methods
      .withdraw(new BN(sharesAmount.toString()))
      .accountsPartial({
        user: owner,
        vaultState: client.vaultState,
        userCard: client.userCard,
        userTokenAccount,
        vaultTokenAccount: client.vaultTokenAccount,
        shareMint: client.shareMint,
        userShareAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
  );
  return send(client, client.connection, instructions);
}
