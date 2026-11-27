import fs from "node:fs";
import path from "node:path";
import { Program, type Idl } from "@coral-xyz/anchor";
import { createMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../target/idl/vault.json";
import { getDevnetProvider } from "./devnet";

async function main(): Promise<void> {
  const { connection, admin, provider } = await getDevnetProvider();
  const program = new Program(idl as Idl, provider);
  const deployedProgram = await connection.getAccountInfo(
    program.programId,
    "confirmed"
  );
  if (!deployedProgram?.executable) {
    throw new Error(
      `Программа ${program.programId.toBase58()} не задеплоена в devnet. ` +
        "Сначала выполните yarn deploy-devnet; TOKEN_A ещё не создавался."
    );
  }

  const tokenMint = await createMint(
    connection,
    admin,
    admin.publicKey,
    admin.publicKey,
    6,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()],
    program.programId
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
    program.programId
  );
  const [shareMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), tokenMint.toBuffer()],
    program.programId
  );

  const signature = await program.methods
    .initializeVault()
    .accountsPartial({
      admin: admin.publicKey,
      tokenMint,
      vaultState,
      vaultTokenAccount,
      shareMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  const config = {
    vaultState: vaultState.toBase58(),
    tokenMint: tokenMint.toBase58(),
    shareMint: shareMint.toBase58(),
    vaultTokenAccount: vaultTokenAccount.toBase58(),
    decimals: 6,
  };
  const configPath = path.resolve(__dirname, "../app/src/vault-config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Vault создан: ${vaultState.toBase58()}`);
  console.log(`TOKEN_A mint: ${tokenMint.toBase58()}`);
  console.log(`Транзакция: ${signature}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
