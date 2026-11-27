import path from "path";
import fs from "fs";
import { PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Raydium, DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import Decimal from "decimal.js";
import { getDevnetProvider } from "./devnet";

// Raydium CLMM program ID on devnet
const RAYDIUM_CLMM_DEVNET_PROGRAM_ID = new PublicKey(
  "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
);

async function main() {
  const { connection, admin: payer } = await getDevnetProvider();

  // [1/3] Создаю тестовые токены...
  console.log("[1/3] Создаю тестовые токены...");

  // Создаем TOKEN_A (6 decimals)
  const tokenAMint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6,
    undefined,
    { commitment: "confirmed" }
  );

  // Создаем TOKEN_B (6 decimals)
  const tokenBMint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6,
    undefined,
    { commitment: "confirmed" }
  );

  console.log(`  TOKEN_A: ${tokenAMint.toBase58()}`);
  console.log(`  TOKEN_B: ${tokenBMint.toBase58()}`);

  // Минтим по 1 000 000 каждого на кошелёк пользователя (1 000 000 * 10^6)
  const amountToMint = 1_000_000 * 10 ** 6;

  const ataA = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    tokenAMint,
    payer.publicKey,
    undefined,
    "confirmed"
  );
  await mintTo(
    connection,
    payer,
    tokenAMint,
    ataA.address,
    payer.publicKey,
    amountToMint,
    [],
    { commitment: "confirmed" }
  );

  const ataB = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    tokenBMint,
    payer.publicKey,
    undefined,
    "confirmed"
  );
  await mintTo(
    connection,
    payer,
    tokenBMint,
    ataB.address,
    payer.publicKey,
    amountToMint,
    [],
    { commitment: "confirmed" }
  );

  // [2/3] Создаю CLMM-пул на Raydium devnet...
  console.log("[2/3] Создаю CLMM-пул на Raydium devnet...");

  const raydium = await Raydium.load({
    connection,
    owner: payer,
    cluster: "devnet",
  });

  // Получаем конфигурации комиссий из API Raydium (devnet)
  const clmmConfigs = await raydium.api.getClmmConfigs();
  // Ищем конфиг: шаг тика 60, комиссия 0.25% (tradeFeeRate = 2500, так как базис 1_000_000 -> 2500/1000000 = 0.25%)
  const ammConfig = clmmConfigs.find(
    (c) => c.tickSpacing === 60 && c.tradeFeeRate === 2500
  );

  if (!ammConfig) {
    throw new Error(
      "Не найден конфиг Raydium CLMM с tickSpacing = 60 и fee = 0.25% на devnet"
    );
  }

  // Создаем пул TOKEN_A / TOKEN_B со стартовой ценой 1 (1 TOKEN_A = 1 TOKEN_B)
  const { execute, extInfo } = await raydium.clmm.createPool({
    programId: RAYDIUM_CLMM_DEVNET_PROGRAM_ID,
    mint1: {
      address: tokenAMint.toBase58(),
      decimals: 6,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    },
    mint2: {
      address: tokenBMint.toBase58(),
      decimals: 6,
      programId: TOKEN_PROGRAM_ID.toBase58(),
    },
    ammConfig: {
      ...ammConfig,
      id: new PublicKey(ammConfig.id),
    },
    initialPrice: new Decimal(1),
  });

  const { txId } = await execute({ sendAndConfirm: true });

  const poolAddress = extInfo.address.poolId.toBase58();
  const explorerUrl = `https://explorer.solana.com/tx/${txId}?cluster=devnet`;

  console.log(`  Pool: ${poolAddress}`);
  console.log(`  Tx: ${explorerUrl}`);

  // [3/3] Сохраняю devnet-pool.json
  console.log("[3/3] Сохраняю devnet-pool.json");

  const poolData = {
    network: "devnet",
    clmmProgramId: RAYDIUM_CLMM_DEVNET_PROGRAM_ID.toBase58(),
    tokenA: tokenAMint.toBase58(),
    tokenB: tokenBMint.toBase58(),
    poolId: poolAddress,
    txId: txId,
    explorerTx: explorerUrl,
    explorerPool: `https://explorer.solana.com/address/${poolAddress}?cluster=devnet`,
    createdAt: new Date().toISOString(),
  };

  const outputPath = path.join(process.cwd(), "devnet-pool.json");
  fs.writeFileSync(outputPath, JSON.stringify(poolData, null, 2), "utf-8");
}

main().catch((err) => {
  console.error("Ошибка при создании пула:", err);
  process.exit(1);
});
