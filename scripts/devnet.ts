import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export async function getDevnetProvider(): Promise<{
  connection: Connection;
  admin: Keypair;
  provider: AnchorProvider;
}> {
  const endpoint =
    process.env.DEVNET_RPC ??
    process.env.VITE_RPC_URL ??
    "https://api.devnet.solana.com";
  const connection = new Connection(endpoint, "confirmed");
  let genesisHash: string;
  try {
    genesisHash = await connection.getGenesisHash();
  } catch (error) {
    throw new Error(
      `Не удалось проверить сеть RPC (${endpoint}): ${String(error)}`
    );
  }
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `Операция отменена: RPC не является Solana devnet (genesis hash: ${genesisHash}).`
    );
  }

  const walletPath =
    process.env.ANCHOR_WALLET ??
    path.join(os.homedir(), ".config/solana/id.json");
  let secret: number[];
  try {
    secret = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  } catch (error) {
    throw new Error(
      `Не удалось прочитать ANCHOR_WALLET (${walletPath}): ${String(error)}`
    );
  }
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return { connection, admin, provider };
}
