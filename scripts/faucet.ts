import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import vaultConfig from "../app/src/vault-config.json";
import { parseAmount } from "../app/src/lib/amount";
import { getDevnetProvider } from "./devnet";

async function main(): Promise<void> {
  const address = process.argv[2];
  if (!address) {
    throw new Error("Использование: yarn faucet <адрес> [сумма TOKEN_A]");
  }

  const { connection, admin, provider } = await getDevnetProvider();
  const recipient = new PublicKey(address);
  if (!vaultConfig.tokenMint) {
    throw new Error(
      "Vault ещё не настроен. Сначала выполните yarn setup-demo."
    );
  }

  const mintAddress = new PublicKey(vaultConfig.tokenMint);
  const mint = await getMint(
    connection,
    mintAddress,
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  if (!mint.mintAuthority?.equals(admin.publicKey)) {
    throw new Error(
      "Выдавать TOKEN_A может только администратор, запустивший setup-demo."
    );
  }

  const tokenAmount = parseAmount(process.argv[3] ?? "1000", mint.decimals);
  if (tokenAmount <= 0n || tokenAmount > BigInt("18446744073709551615")) {
    throw new Error(
      "Сумма TOKEN_A должна быть больше нуля и помещаться в u64."
    );
  }

  const tokenAccount = getAssociatedTokenAddressSync(mintAddress, recipient);
  const transaction = new Transaction();
  const tokenAccountInfo = await connection.getAccountInfo(
    tokenAccount,
    "confirmed"
  );
  if (tokenAccountInfo) {
    await getAccount(connection, tokenAccount, "confirmed", TOKEN_PROGRAM_ID);
  } else {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        tokenAccount,
        recipient,
        mintAddress,
        TOKEN_PROGRAM_ID
      )
    );
  }
  transaction.add(
    createMintToInstruction(
      mintAddress,
      tokenAccount,
      admin.publicKey,
      tokenAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  const lamports = await connection.getBalance(recipient, "confirmed");
  if (lamports < 10_000_000) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: recipient,
        lamports: 20_000_000,
      })
    );
  }

  const signature = await provider.sendAndConfirm(transaction);
  console.log(
    `Отправлено ${process.argv[3] ?? "1000"} TOKEN_A на ${recipient.toBase58()}`
  );
  if (lamports < 10_000_000) {
    console.log("Отправлено 0.02 SOL.");
  }
  console.log(`Транзакция: ${signature}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
