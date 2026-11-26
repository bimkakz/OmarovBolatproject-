import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { Raydium, PoolUtils } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import Decimal from "decimal.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Vault } from "../target/types/vault";

const CLMM_PROGRAM_ID = new PublicKey(
  "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"
);
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const U64_MAX = new anchor.BN("18446744073709551615");
const DEPOSIT_AMOUNT = new anchor.BN(300_000_000);

describe("raydium devnet", function () {
  this.timeout(600_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const admin = provider.wallet as anchor.Wallet;
  const payer = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;

  let tokenMintA: PublicKey;
  let tokenMintB: PublicKey;
  let tokenMintC: PublicKey;
  let vaultState: PublicKey;
  let vaultTokenAccount: PublicKey;
  let vaultTokenAccountB: PublicKey;
  let shareMint: PublicKey;
  let adminTokenAccountA: PublicKey;
  let adminShareAccount: PublicKey;
  let userCard: PublicKey;
  let raydium: Awaited<ReturnType<typeof Raydium.load>>;
  let pairPoolId: PublicKey;
  let wrongPairPoolId: PublicKey;

  async function createPool(
    mintB: PublicKey,
    addLiquidity: boolean
  ): Promise<PublicKey> {
    const configs = await raydium.api.getClmmConfigs();
    const config = configs.find(
      (item) => item.tickSpacing === 60 && item.tradeFeeRate === 2500
    );
    if (!config) {
      throw new Error("Missing devnet Raydium CLMM config (tickSpacing 60)");
    }

    const created = await raydium.clmm.createPool({
      programId: CLMM_PROGRAM_ID,
      mint1: apiToken(tokenMintA),
      mint2: apiToken(mintB),
      ammConfig: {
        ...config,
        id: new PublicKey(config.id),
        fundOwner: PublicKey.default.toBase58(),
      },
      initialPrice: new Decimal(1),
    });
    await created.execute({ sendAndConfirm: true });

    if (addLiquidity) {
      const position = await raydium.clmm.openPositionFromBase({
        poolInfo: created.extInfo.mockPoolInfo,
        poolKeys: created.extInfo.address,
        ownerInfo: { useSOLBalance: false },
        tickLower: -60_000,
        tickUpper: 60_000,
        base: "MintA",
        baseAmount: new BN(10_000_000_000),
        otherAmountMax: new BN(10_000_000_000),
        withMetadata: "no-create",
      });
      await position.execute({ sendAndConfirm: true });
    }

    return new PublicKey(created.extInfo.address.id);
  }

  async function poolAccounts(
    poolId: PublicKey,
    inputMint: PublicKey,
    outputMint: PublicKey,
    computeQuote = true
  ) {
    const pool = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
    const quote = computeQuote
      ? PoolUtils.computeAmountOutFormat({
          poolInfo: pool.computePoolInfo,
          tickarrayBitmapExtension: pool.computePoolInfo.exBitmapInfo,
          tickArrayCache: pool.tickData[poolId.toBase58()],
          amountIn: new BN(DEPOSIT_AMOUNT.toString()),
          tokenOut:
            pool.poolInfo.mintA.address === outputMint.toBase58()
              ? pool.poolInfo.mintA
              : pool.poolInfo.mintB,
          slippage: 0.01,
          epochInfo: await provider.connection.getEpochInfo(),
          blockTimestamp: Math.floor(Date.now() / 1000),
        })
      : undefined;

    const inputVault = pool.rpcPoolInfo.mintA.equals(inputMint)
      ? pool.rpcPoolInfo.vaultA
      : pool.rpcPoolInfo.vaultB;
    const outputVault = pool.rpcPoolInfo.mintA.equals(outputMint)
      ? pool.rpcPoolInfo.vaultA
      : pool.rpcPoolInfo.vaultB;

    return {
      accounts: {
        clmmProgram: CLMM_PROGRAM_ID,
        ammConfig: pool.computePoolInfo.ammConfig.id,
        poolState: poolId,
        inputTokenAccount: inputMint.equals(tokenMintA)
          ? vaultTokenAccount
          : vaultTokenAccountB,
        outputTokenAccount: outputMint.equals(tokenMintA)
          ? vaultTokenAccount
          : vaultTokenAccountB,
        inputVault,
        outputVault,
        observationState: pool.computePoolInfo.observationId,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
        inputVaultMint: inputMint,
        outputVaultMint: outputMint,
      },
      remainingAccounts: (quote?.remainingAccounts ?? []).map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      })),
      minAmountOut: new anchor.BN(
        quote?.minAmountOut.amount.raw.toString() ?? "1"
      ),
    };
  }

  async function submitSwap(
    inputMint: PublicKey,
    outputMint: PublicKey,
    poolId: PublicKey,
    amountIn: anchor.BN,
    minAmountOut: anchor.BN
  ) {
    const pool = await poolAccounts(poolId, inputMint, outputMint);
    return program.methods
      .swap(amountIn, minAmountOut, inputMint.equals(tokenMintA))
      .accounts({
        admin: admin.publicKey,
        vaultState,
        ...pool.accounts,
      })
      .remainingAccounts(pool.remainingAccounts)
      .rpc();
  }

  const unauthorizedAdmin = Keypair.generate();

  before(async () => {
    tokenMintA = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      6
    );
    tokenMintB = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      6
    );
    tokenMintC = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      6
    );

    adminTokenAccountA = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        tokenMintA,
        admin.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      tokenMintA,
      adminTokenAccountA,
      admin.publicKey,
      1_000_000_000_000
    );
    const adminTokenAccountB = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        tokenMintB,
        admin.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      tokenMintB,
      adminTokenAccountB,
      admin.publicKey,
      1_000_000_000_000
    );

    raydium = await Raydium.load({
      connection: provider.connection,
      owner: payer,
      cluster: "devnet",
    });
    pairPoolId = await createPool(tokenMintB, true);
    wrongPairPoolId = await createPool(tokenMintC, false);

    [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMintA.toBuffer()],
      program.programId
    );
    [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMintA.toBuffer()],
      program.programId
    );
    [vaultTokenAccountB] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens_b"), tokenMintA.toBuffer()],
      program.programId
    );
    [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMintA.toBuffer()],
      program.programId
    );

    await program.methods
      .initializeVault()
      .accounts({
        admin: admin.publicKey,
        tokenMint: tokenMintA,
        vaultState,
        vaultTokenAccount,
        shareMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    adminShareAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        shareMint,
        admin.publicKey
      )
    ).address;
    [userCard] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_card"),
        vaultState.toBuffer(),
        admin.publicKey.toBuffer(),
      ],
      program.programId
    );
    await program.methods
      .createUserCard()
      .accounts({
        user: admin.publicKey,
        vaultState,
        userCard,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("add_pair_token: запрещает не-админу и создаёт TOKEN_B для админа", async () => {
    try {
      await program.methods
        .addPairToken()
        .accounts({
          admin: unauthorizedAdmin.publicKey,
          vaultState,
          tokenMintB,
          vaultTokenAccountB,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([unauthorizedAdmin])
        .rpc();
      assert.fail("Ожидалась ошибка Unauthorized");
    } catch (error) {
      expect(String(error)).to.include("Unauthorized");
    }

    await program.methods
      .addPairToken()
      .accounts({
        admin: admin.publicKey,
        vaultState,
        tokenMintB,
        vaultTokenAccountB,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const pairAccount = await program.account.vaultState.fetch(vaultState);
    expect(pairAccount.tokenMintB.toBase58()).to.equal(tokenMintB.toBase58());
    expect(pairAccount.vaultTokenAccountB.toBase58()).to.equal(
      vaultTokenAccountB.toBase58()
    );

    try {
      await program.methods
        .addPairToken()
        .accounts({
          admin: admin.publicKey,
          vaultState,
          tokenMintB,
          vaultTokenAccountB,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Ожидалась ошибка PairTokenAlreadyAdded");
    } catch (error) {
      expect(String(error)).to.include("PairTokenAlreadyAdded");
    }
  });

  it("swap: запрещает не-админу", async () => {
    const pool = await poolAccounts(pairPoolId, tokenMintA, tokenMintB);
    try {
      await program.methods
        .swap(DEPOSIT_AMOUNT, new anchor.BN(1), true)
        .accounts({
          admin: unauthorizedAdmin.publicKey,
          vaultState,
          ...pool.accounts,
        })
        .remainingAccounts(pool.remainingAccounts)
        .signers([unauthorizedAdmin])
        .rpc();
      assert.fail("Ожидалась ошибка Unauthorized");
    } catch (error) {
      expect(String(error)).to.include("Unauthorized");
    }
  });

  it("swap: отклоняет пул другой пары и перепутанные хранилища пула", async () => {
    const wrongPair = await poolAccounts(
      wrongPairPoolId,
      tokenMintA,
      tokenMintC,
      false
    );
    try {
      await program.methods
        .swap(DEPOSIT_AMOUNT, new anchor.BN(1), true)
        .accounts({
          admin: admin.publicKey,
          vaultState,
          ...wrongPair.accounts,
        })
        .remainingAccounts(wrongPair.remainingAccounts)
        .rpc();
      assert.fail("Ожидалась ошибка WrongPool для пары A/C");
    } catch (error) {
      expect(String(error)).to.include("WrongPool");
    }

    const correctPool = await poolAccounts(pairPoolId, tokenMintA, tokenMintB);
    try {
      await program.methods
        .swap(DEPOSIT_AMOUNT, new anchor.BN(1), true)
        .accounts({
          admin: admin.publicKey,
          vaultState,
          ...correctPool.accounts,
          inputVault: correctPool.accounts.outputVault,
          outputVault: correctPool.accounts.inputVault,
          inputVaultMint: tokenMintB,
          outputVaultMint: tokenMintA,
        })
        .remainingAccounts(correctPool.remainingAccounts)
        .rpc();
      assert.fail("Ожидалась ошибка WrongPool для переставленных vault");
    } catch (error) {
      expect(String(error)).to.include("WrongPool");
    }
  });

  it("swap: проверяет min_amount_out и обменивает 300 TOKEN_A на TOKEN_B", async () => {
    await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accounts({
        user: admin.publicKey,
        vaultState,
        userCard,
        userTokenAccount: adminTokenAccountA,
        vaultTokenAccount,
        shareMint,
        userShareAccount: adminShareAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    try {
      await submitSwap(
        tokenMintA,
        tokenMintB,
        pairPoolId,
        DEPOSIT_AMOUNT,
        U64_MAX
      );
      assert.fail("Ожидалась ошибка TooLittleOutputReceived");
    } catch (error) {
      expect(String(error)).to.include("TooLittleOutputReceived");
    }

    const beforeShares = (
      await program.account.vaultState.fetch(vaultState)
    ).totalShares.toString();
    await submitSwap(
      tokenMintA,
      tokenMintB,
      pairPoolId,
      U64_MAX,
      new anchor.BN(1)
    );

    const state = await program.account.vaultState.fetch(vaultState);
    expect(state.inMarket).to.equal(true);
    expect(state.totalShares.toString()).to.equal(beforeShares);
    expect(await getTokenAccountAmount(vaultTokenAccountB)).to.be.greaterThan(
      0
    );
  });

  it("deposit и withdraw приостанавливаются, пока средства в рынке", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(1))
        .accounts({
          user: admin.publicKey,
          vaultState,
          userCard,
          userTokenAccount: adminTokenAccountA,
          vaultTokenAccount,
          shareMint,
          userShareAccount: adminShareAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Ожидалась ошибка InMarket при deposit");
    } catch (error) {
      expect(String(error)).to.include("InMarket");
    }

    try {
      await program.methods
        .withdraw(new anchor.BN(1))
        .accounts({
          user: admin.publicKey,
          vaultState,
          userCard,
          userTokenAccount: adminTokenAccountA,
          vaultTokenAccount,
          shareMint,
          userShareAccount: adminShareAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Ожидалась ошибка InMarket при withdraw");
    } catch (error) {
      expect(String(error)).to.include("InMarket");
    }
  });

  it("sync_vault: требует нулевой TOKEN_B и права админа", async () => {
    try {
      await program.methods
        .syncVault()
        .accounts({
          admin: admin.publicKey,
          vaultState,
          vaultTokenAccount,
          vaultTokenAccountB,
        })
        .rpc();
      assert.fail("Ожидалась ошибка TokenBNotZero");
    } catch (error) {
      expect(String(error)).to.include("TokenBNotZero");
    }

    const reverse = await poolAccounts(pairPoolId, tokenMintB, tokenMintA);
    try {
      await program.methods
        .swap(new anchor.BN(1), new anchor.BN(1), false)
        .accounts({
          admin: unauthorizedAdmin.publicKey,
          vaultState,
          ...reverse.accounts,
        })
        .remainingAccounts(reverse.remainingAccounts)
        .signers([unauthorizedAdmin])
        .rpc();
      assert.fail("Ожидалась ошибка Unauthorized");
    } catch (error) {
      expect(String(error)).to.include("Unauthorized");
    }

    try {
      await program.methods
        .syncVault()
        .accounts({
          admin: unauthorizedAdmin.publicKey,
          vaultState,
          vaultTokenAccount,
          vaultTokenAccountB,
        })
        .signers([unauthorizedAdmin])
        .rpc();
      assert.fail("Ожидалась ошибка Unauthorized");
    } catch (error) {
      expect(String(error)).to.include("Unauthorized");
    }

    const reverseQuote = await poolAccounts(pairPoolId, tokenMintB, tokenMintA);
    const syncInstruction = await program.methods
      .syncVault()
      .accounts({
        admin: admin.publicKey,
        vaultState,
        vaultTokenAccount,
        vaultTokenAccountB,
      })
      .instruction();
    await program.methods
      .swap(U64_MAX, new anchor.BN(1), false)
      .accounts({
        admin: admin.publicKey,
        vaultState,
        ...reverseQuote.accounts,
      })
      .remainingAccounts(reverseQuote.remainingAccounts)
      .postInstructions([syncInstruction])
      .rpc();

    const synced = await program.account.vaultState.fetch(vaultState);
    expect(synced.inMarket).to.equal(false);
    expect(synced.totalTokens.toString()).to.equal(
      (await getTokenAccountAmount(vaultTokenAccount)).toString()
    );
  });
});

async function getTokenAccountAmount(account: PublicKey): Promise<number> {
  return Number(
    (await getAccount(anchor.getProvider().connection, account)).amount
  );
}

function apiToken(mint: PublicKey) {
  return {
    chainId: 101,
    address: mint.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    logoURI: "",
    symbol: "TEST",
    name: "Test token",
    decimals: 6,
    tags: [],
    extensions: {},
  };
}
