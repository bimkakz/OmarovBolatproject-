import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import {
  createAccount,
  createMint,
  mintTo,
  getAccount,
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

  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const userC = Keypair.generate(); // without card

  let userATokenAccount: PublicKey;
  let userAShareAccount: PublicKey;
  let userBTokenAccount: PublicKey;
  let userBShareAccount: PublicKey;
  let userCTokenAccount: PublicKey;
  let userCShareAccount: PublicKey;

  before(async () => {
    // Airdrop SOL to test users
    for (const user of [userA, userB, userC]) {
      const airdrop = await provider.connection.requestAirdrop(
        user.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction({
        signature: airdrop,
        ...latestBlockhash,
      });
    }

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

    // Create token accounts and share accounts for users using createAccount from @solana/spl-token
    userATokenAccount = await createAccount(
      provider.connection,
      (provider.wallet as any).payer,
      tokenMint,
      userA.publicKey
    );
    userAShareAccount = await createAccount(
      provider.connection,
      (provider.wallet as any).payer,
      shareMintPda,
      userA.publicKey
    );

    userBTokenAccount = await createAccount(
      provider.connection,
      (provider.wallet as any).payer,
      tokenMint,
      userB.publicKey
    );
    userBShareAccount = await createAccount(
      provider.connection,
      (provider.wallet as any).payer,
      shareMintPda,
      userB.publicKey
    );

    userCTokenAccount = await createAccount(
      provider.connection,
      (provider.wallet as any).payer,
      tokenMint,
      userC.publicKey
    );
    userCShareAccount = await createAccount(
      provider.connection,
      (provider.wallet as any).payer,
      shareMintPda,
      userC.publicKey
    );

    // Mint initial tokens to users
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      tokenMint,
      userATokenAccount,
      admin.publicKey,
      1000
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      tokenMint,
      userBTokenAccount,
      admin.publicKey,
      1000
    );
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      tokenMint,
      userCTokenAccount,
      admin.publicKey,
      1000
    );
  });

  it("create_user_card: у каждого пользователя своя карточка", async () => {
    const [userACardPda, userABump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userA.publicKey.toBuffer()],
      program.programId
    );

    const [userBCardPda, userBBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userB.publicKey.toBuffer()],
      program.programId
    );

    // User A creates card
    await program.methods
      .createUserCard()
      .accounts({
        user: userA.publicKey,
        vaultState: vaultStatePda,
        userCard: userACardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([userA])
      .rpc();

    // User B creates card
    await program.methods
      .createUserCard()
      .accounts({
        user: userB.publicKey,
        vaultState: vaultStatePda,
        userCard: userBCardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([userB])
      .rpc();

    const cardA = await program.account.userCard.fetch(userACardPda);
    const cardB = await program.account.userCard.fetch(userBCardPda);

    expect(cardA.vault.toBase58()).to.equal(vaultStatePda.toBase58());
    expect(cardA.owner.toBase58()).to.equal(userA.publicKey.toBase58());
    expect(cardA.deposited.toNumber()).to.equal(0);
    expect(cardA.shares.toNumber()).to.equal(0);
    expect(cardA.bump).to.equal(userABump);

    expect(cardB.vault.toBase58()).to.equal(vaultStatePda.toBase58());
    expect(cardB.owner.toBase58()).to.equal(userB.publicKey.toBase58());
    expect(cardB.deposited.toNumber()).to.equal(0);
    expect(cardB.shares.toNumber()).to.equal(0);
    expect(cardB.bump).to.equal(userBBump);

    expect(userACardPda.toBase58()).to.not.equal(userBCardPda.toBase58());
  });

  it("create_user_card: вторая карточка для того же пользователя — ошибка", async () => {
    const [userACardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userA.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createUserCard()
        .accounts({
          user: userA.publicKey,
          vaultState: vaultStatePda,
          userCard: userACardPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([userA])
        .rpc();
      assert.fail("Ожидалась ошибка при повторном создании карточки пользователя");
    } catch (err: any) {
      expect(err).to.exist;
      const errMsg = err.toString();
      const isAlreadyInUse =
        errMsg.includes("already in use") ||
        errMsg.includes("custom program error: 0x0") ||
        errMsg.includes("0x0");
      expect(isAlreadyInUse).to.be.true;
    }
  });

  it("deposit с суммой 0 — ошибка", async () => {
    const [userACardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userA.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .deposit(new anchor.BN(0))
        .accounts({
          user: userA.publicKey,
          vaultState: vaultStatePda,
          userCard: userACardPda,
          userTokenAccount: userATokenAccount,
          vaultTokenAccount: vaultTokenAccountPda,
          shareMint: shareMintPda,
          userShareAccount: userAShareAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userA])
        .rpc();
      assert.fail("Ожидалась ошибка ZeroAmount при сумме 0");
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  it("deposit без карточки — ошибка", async () => {
    // User C has no user_card PDA initialized
    const [userCCardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userC.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .deposit(new anchor.BN(100))
        .accounts({
          user: userC.publicKey,
          vaultState: vaultStatePda,
          userCard: userCCardPda,
          userTokenAccount: userCTokenAccount,
          vaultTokenAccount: vaultTokenAccountPda,
          shareMint: shareMintPda,
          userShareAccount: userCShareAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userC])
        .rpc();
      assert.fail("Ожидалась ошибка депозита без карточки");
    } catch (err: any) {
      expect(err).to.exist;
      const errMsg = err.toString();
      const isUninitialized =
        errMsg.includes("AccountNotInitialized") ||
        errMsg.includes("has not been initialized") ||
        errMsg.includes("3012");
      expect(isUninitialized).to.be.true;
    }
  });

  it("A вносит 100 токенов -> 100 shares", async () => {
    const [userACardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userA.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .deposit(new anchor.BN(100))
      .accounts({
        user: userA.publicKey,
        vaultState: vaultStatePda,
        userCard: userACardPda,
        userTokenAccount: userATokenAccount,
        vaultTokenAccount: vaultTokenAccountPda,
        shareMint: shareMintPda,
        userShareAccount: userAShareAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userA])
      .rpc();

    const vaultAccount = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultAccount.totalTokens.toNumber()).to.equal(100);
    expect(vaultAccount.totalShares.toNumber()).to.equal(100);

    const cardA = await program.account.userCard.fetch(userACardPda);
    expect(cardA.deposited.toNumber()).to.equal(100);
    expect(cardA.shares.toNumber()).to.equal(100);

    const shareAccountA = await getAccount(provider.connection, userAShareAccount);
    expect(Number(shareAccountA.amount)).to.equal(100);

    const vaultTokenAccount = await getAccount(
      provider.connection,
      vaultTokenAccountPda
    );
    expect(Number(vaultTokenAccount.amount)).to.equal(100);
  });

  it("B вносит 50 -> 50 shares (в vault 150 токенов и 150 shares)", async () => {
    const [userBCardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePda.toBuffer(), userB.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .deposit(new anchor.BN(50))
      .accounts({
        user: userB.publicKey,
        vaultState: vaultStatePda,
        userCard: userBCardPda,
        userTokenAccount: userBTokenAccount,
        vaultTokenAccount: vaultTokenAccountPda,
        shareMint: shareMintPda,
        userShareAccount: userBShareAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userB])
      .rpc();

    const vaultAccount = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultAccount.totalTokens.toNumber()).to.equal(150);
    expect(vaultAccount.totalShares.toNumber()).to.equal(150);

    const cardB = await program.account.userCard.fetch(userBCardPda);
    expect(cardB.deposited.toNumber()).to.equal(50);
    expect(cardB.shares.toNumber()).to.equal(50);

    const shareAccountB = await getAccount(provider.connection, userBShareAccount);
    expect(Number(shareAccountB.amount)).to.equal(50);

    const vaultTokenAccount = await getAccount(
      provider.connection,
      vaultTokenAccountPda
    );
    expect(Number(vaultTokenAccount.amount)).to.equal(150);
  });
});
