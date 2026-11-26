import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import {
  createMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

describe("vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const admin = provider.wallet as anchor.Wallet;

  let tokenMint: PublicKey;
  let vaultStatePda: PublicKey;
  let vaultBump: number;
  let vaultTokenAccountPda: PublicKey;
  let shareMintPda: PublicKey;

  const user1 = Keypair.generate();
  const user2 = Keypair.generate();

  before(async () => {
    // Airdrop SOL to test users
    const airdrop1 = await provider.connection.requestAirdrop(
      user1.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const airdrop2 = await provider.connection.requestAirdrop(
      user2.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdrop1,
      ...latestBlockhash,
    });
    await provider.connection.confirmTransaction({
      signature: airdrop2,
      ...latestBlockhash,
    });

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      admin.publicKey,
      null,
      6
    );

    [vaultStatePda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );

    [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId
    );

    [shareMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId
    );
  });

  it("initialize_vault: vault создан", async () => {
    await program.methods
      .initializeVault()
      .accounts({
        admin: admin.publicKey,
        tokenMint: tokenMint,
        vaultState: vaultStatePda,
        vaultTokenAccount: vaultTokenAccountPda,
        shareMint: shareMintPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const vaultAccount = await program.account.vaultState.fetch(vaultStatePda);

    expect(vaultAccount.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(vaultAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(vaultAccount.vaultTokenAccount.toBase58()).to.equal(
      vaultTokenAccountPda.toBase58()
    );
    expect(vaultAccount.shareMint.toBase58()).to.equal(shareMintPda.toBase58());
    expect(vaultAccount.totalTokens.toNumber()).to.equal(0);
    expect(vaultAccount.totalShares.toNumber()).to.equal(0);
    expect(vaultAccount.bump).to.equal(vaultBump);
  });

  it("create_user_card: у каждого пользователя своя карточка", async () => {
    const [user1CardPda, user1Bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    const [user2CardPda, user2Bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    );

    // User 1 creates card
    await program.methods
      .createUserCard()
      .accounts({
        user: user1.publicKey,
        vaultState: vaultStatePda,
        userCard: user1CardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // User 2 creates card
    await program.methods
      .createUserCard()
      .accounts({
        user: user2.publicKey,
        vaultState: vaultStatePda,
        userCard: user2CardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    const card1 = await program.account.userCard.fetch(user1CardPda);
    const card2 = await program.account.userCard.fetch(user2CardPda);

    expect(card1.vault.toBase58()).to.equal(vaultStatePda.toBase58());
    expect(card1.owner.toBase58()).to.equal(user1.publicKey.toBase58());
    expect(card1.deposited.toNumber()).to.equal(0);
    expect(card1.shares.toNumber()).to.equal(0);
    expect(card1.bump).to.equal(user1Bump);

    expect(card2.vault.toBase58()).to.equal(vaultStatePda.toBase58());
    expect(card2.owner.toBase58()).to.equal(user2.publicKey.toBase58());
    expect(card2.deposited.toNumber()).to.equal(0);
    expect(card2.shares.toNumber()).to.equal(0);
    expect(card2.bump).to.equal(user2Bump);

    expect(user1CardPda.toBase58()).to.not.equal(user2CardPda.toBase58());
  });

  it("create_user_card: вторая карточка для того же пользователя — ошибка", async () => {
    const [user1CardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createUserCard()
        .accounts({
          user: user1.publicKey,
          vaultState: vaultStatePda,
          userCard: user1CardPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
      assert.fail("Ожидалась ошибка при повторном создании карточки пользователя");
    } catch (err: any) {
      // Ожидаем ошибку 'account already in use' или anchor error 0x0
      expect(err).to.exist;
      const errMsg = err.toString();
      const isAlreadyInUse =
        errMsg.includes("already in use") ||
        errMsg.includes("custom program error: 0x0") ||
        errMsg.includes("0x0");
      expect(isAlreadyInUse).to.be.true;
    }
  });
});
