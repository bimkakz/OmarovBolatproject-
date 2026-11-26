import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  transfer as splTransfer,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import {
  getPdaMetadataKey,
  getPdaPersonalPositionAddress,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
  PoolUtils,
  Raydium,
  TickArrayUtil,
} from "@raydium-io/raydium-sdk-v2";
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
const SWAP_AMOUNT = new anchor.BN(300_000_000);
const DEPOSIT_AMOUNT = new anchor.BN(1_000_000_000);
const POSITION_LOWER_TICK = -2_220;
const POSITION_UPPER_TICK = 2_220;

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
  let vault2State: PublicKey;
  let vault2TokenAccount: PublicKey;
  let vault2TokenAccountB: PublicKey;
  let vault2ShareMint: PublicKey;
  let shareMint: PublicKey;
  let adminTokenAccountA: PublicKey;
  let adminTokenAccountB: PublicKey;
  let userTokenAccountA: PublicKey;
  let userShareAccount: PublicKey;
  let userCard: PublicKey;
  let user: Keypair;
  let raydium: Awaited<ReturnType<typeof Raydium.load>>;
  let pairPoolId: PublicKey;
  let wrongPairPoolId: PublicKey;
  let vaultPosition: Awaited<ReturnType<typeof positionAccounts>>;

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
        description: "",
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
    computeQuote = true,
    inputAccount?: PublicKey,
    outputAccount?: PublicKey,
    quoteAmount = new BN(SWAP_AMOUNT.toString())
  ) {
    const pool = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
    const quote = computeQuote
      ? PoolUtils.computeAmountOutFormat({
          poolInfo: pool.computePoolInfo,
          tickarrayBitmapExtension: pool.computePoolInfo.exBitmapInfo,
          tickArrayCache: pool.tickData[poolId.toBase58()],
          amountIn: quoteAmount,
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
        inputTokenAccount:
          inputAccount ??
          (inputMint.equals(tokenMintA)
            ? vaultTokenAccount
            : vaultTokenAccountB),
        outputTokenAccount:
          outputAccount ??
          (outputMint.equals(tokenMintA)
            ? vaultTokenAccount
            : vaultTokenAccountB),
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
    const defaultInputAccount = inputMint.equals(tokenMintA)
      ? vaultTokenAccount
      : vaultTokenAccountB;
    const amountForQuote = amountIn.eq(U64_MAX)
      ? new BN(await getTokenAccountAmount(defaultInputAccount))
      : new BN(amountIn.toString());
    const pool = await poolAccounts(
      poolId,
      inputMint,
      outputMint,
      true,
      undefined,
      undefined,
      amountForQuote
    );
    return program.methods
      .swap(amountIn, minAmountOut, inputMint.equals(tokenMintA))
      .accountsPartial({
        admin: admin.publicKey,
        vaultState,
        ...pool.accounts,
      })
      .remainingAccounts(pool.remainingAccounts)
      .rpc();
  }

  async function positionAccounts(
    poolId: PublicKey,
    vaultAddress: PublicKey,
    vaultAccountA: PublicKey,
    vaultAccountB: PublicKey,
    mintAForVault = tokenMintA,
    mintBForVault = tokenMintB,
    tickLower = POSITION_LOWER_TICK,
    tickUpper = POSITION_UPPER_TICK
  ) {
    const pool = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
    if (
      !pool.rpcPoolInfo.mintA.equals(mintAForVault) &&
      !pool.rpcPoolInfo.mintA.equals(mintBForVault)
    ) {
      throw new Error("Vault tokens do not match the pool pair");
    }
    const nftMint = Keypair.generate();
    const mint0IsA = pool.rpcPoolInfo.mintA.equals(mintAForVault);
    if (!mint0IsA && !pool.rpcPoolInfo.mintA.equals(mintBForVault)) {
      throw new Error("Vault tokens do not match the pool pair");
    }
    const account0 = mint0IsA ? vaultAccountA : vaultAccountB;
    const account1 = mint0IsA ? vaultAccountB : vaultAccountA;
    const amount0 = await getTokenAccountAmount(account0);
    const amount1 = await getTokenAccountAmount(account1);
    const tickArrayLowerStart = TickArrayUtil.getTickArrayStartIndex(
      tickLower,
      pool.rpcPoolInfo.tickSpacing
    );
    const tickArrayUpperStart = TickArrayUtil.getTickArrayStartIndex(
      tickUpper,
      pool.rpcPoolInfo.tickSpacing
    );
    const personalPosition = getPdaPersonalPositionAddress(
      CLMM_PROGRAM_ID,
      nftMint.publicKey
    ).publicKey;

    return {
      nftMint,
      tickLower,
      tickUpper,
      tickArrayLowerStart,
      tickArrayUpperStart,
      amount0: new anchor.BN(amount0),
      amount1: new anchor.BN(amount1),
      base0: amount0 <= amount1,
      pool,
      accounts: {
        admin: admin.publicKey,
        vaultState: vaultAddress,
        clmmProgram: CLMM_PROGRAM_ID,
        poolState: poolId,
        positionNftMint: nftMint.publicKey,
        positionNftAccount: getAssociatedTokenAddressSync(
          nftMint.publicKey,
          vaultAddress,
          true
        ),
        metadataAccount: getPdaMetadataKey(nftMint.publicKey).publicKey,
        protocolPosition: getPdaProtocolPositionAddress(
          CLMM_PROGRAM_ID,
          poolId,
          tickLower,
          tickUpper
        ).publicKey,
        tickArrayLower: getPdaTickArrayAddress(
          CLMM_PROGRAM_ID,
          poolId,
          tickArrayLowerStart
        ).publicKey,
        tickArrayUpper: getPdaTickArrayAddress(
          CLMM_PROGRAM_ID,
          poolId,
          tickArrayUpperStart
        ).publicKey,
        personalPosition,
        vaultTokenAccountA: vaultAccountA,
        vaultTokenAccountB: vaultAccountB,
        tokenVault0: pool.rpcPoolInfo.vaultA,
        tokenVault1: pool.rpcPoolInfo.vaultB,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        metadataProgram: new PublicKey(
          "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        ),
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        vault0Mint: pool.rpcPoolInfo.mintA,
        vault1Mint: pool.rpcPoolInfo.mintB,
      },
    };
  }

  async function tradePool(inputMint: PublicKey, amountIn: BN) {
    const poolId = pairPoolId;
    const pool = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58());
    const tokenOut =
      pool.poolInfo.mintA.address === inputMint.toBase58()
        ? pool.poolInfo.mintB
        : pool.poolInfo.mintA;
    const quote = PoolUtils.computeAmountOutFormat({
      poolInfo: pool.computePoolInfo,
      tickarrayBitmapExtension: pool.computePoolInfo.exBitmapInfo,
      tickArrayCache: pool.tickData[poolId.toBase58()],
      amountIn,
      tokenOut,
      slippage: 0.01,
      epochInfo: await provider.connection.getEpochInfo(),
      blockTimestamp: Math.floor(Date.now() / 1000),
    });

    const transaction = await raydium.clmm.swap({
      poolInfo: pool.poolInfo,
      poolKeys: pool.poolKeys,
      inputMint,
      amountIn,
      amountOutMin: quote.minAmountOut.amount.raw,
      observationId: pool.computePoolInfo.observationId,
      ownerInfo: { useSOLBalance: false },
      remainingAccounts: quote.remainingAccounts,
    });
    await transaction.execute({ sendAndConfirm: true });
  }

  function positionActionAccounts(
    position: Awaited<ReturnType<typeof positionAccounts>>,
    adminKey: PublicKey
  ) {
    const accounts = position.accounts;
    return {
      admin: adminKey,
      vaultState: accounts.vaultState,
      positionNftMint: accounts.positionNftMint,
      nftAccount: accounts.positionNftAccount,
      personalPosition: accounts.personalPosition,
      poolState: accounts.poolState,
      protocolPosition: accounts.protocolPosition,
      tokenVault0: accounts.tokenVault0,
      tokenVault1: accounts.tokenVault1,
      tickArrayLower: accounts.tickArrayLower,
      tickArrayUpper: accounts.tickArrayUpper,
      vaultTokenAccountA: accounts.vaultTokenAccountA,
      vaultTokenAccountB: accounts.vaultTokenAccountB,
      tokenProgram: accounts.tokenProgram,
      tokenProgram2022: accounts.tokenProgram2022,
      memoProgram: MEMO_PROGRAM_ID,
      vault0Mint: accounts.vault0Mint,
      vault1Mint: accounts.vault1Mint,
      clmmProgram: accounts.clmmProgram,
    };
  }

  let unauthorizedAdmin: Keypair;

  before(async () => {
    user = Keypair.generate();
    unauthorizedAdmin = user;
    const userAirdrop = await provider.connection.requestAirdrop(
      user.publicKey,
      anchor.web3.LAMPORTS_PER_SOL / 5
    );
    const userBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: userAirdrop,
      ...userBlockhash,
    });

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
    adminTokenAccountB = (
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
    await raydium.account.fetchWalletTokenAccounts({ forceUpdate: true });
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
      .accountsPartial({
        admin: admin.publicKey,
        tokenMint: tokenMintA,
        vaultState,
        vaultTokenAccount,
        shareMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    userTokenAccountA = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        tokenMintA,
        user.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      tokenMintA,
      userTokenAccountA,
      admin.publicKey,
      DEPOSIT_AMOUNT.toNumber()
    );
    userShareAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        shareMint,
        user.publicKey
      )
    ).address;
    [userCard] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_card"),
        vaultState.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );
    await program.methods
      .createUserCard()
      .accountsPartial({
        user: user.publicKey,
        vaultState,
        userCard,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  });

  it("add_pair_token: запрещает не-админу и создаёт TOKEN_B для админа", async () => {
    try {
      await program.methods
        .addPairToken()
        .accountsPartial({
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
      .accountsPartial({
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
        .accountsPartial({
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
        .accountsPartial({
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
        .accountsPartial({
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
        .accountsPartial({
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
      .accountsPartial({
        user: user.publicKey,
        vaultState,
        userCard,
        userTokenAccount: userTokenAccountA,
        vaultTokenAccount,
        shareMint,
        userShareAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    try {
      await submitSwap(
        tokenMintA,
        tokenMintB,
        pairPoolId,
        SWAP_AMOUNT,
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
      SWAP_AMOUNT,
      new anchor.BN(1)
    );

    const state = await program.account.vaultState.fetch(vaultState);
    expect(state.inMarket).to.equal(true);
    expect(state.totalShares.toString()).to.equal(beforeShares);
    expect(await getTokenAccountAmount(vaultTokenAccountB)).to.be.greaterThan(
      0
    );
  });

  it("open_position: админ открывает одну позицию по паре vault в диапазоне 0.8–1.25", async () => {
    vaultPosition = await positionAccounts(
      pairPoolId,
      vaultState,
      vaultTokenAccount,
      vaultTokenAccountB
    );

    try {
      await program.methods
        .openPosition(
          vaultPosition.tickLower,
          vaultPosition.tickUpper,
          vaultPosition.tickArrayLowerStart,
          vaultPosition.tickArrayUpperStart,
          vaultPosition.amount0,
          vaultPosition.amount1,
          vaultPosition.base0
        )
        .accountsPartial({
          ...vaultPosition.accounts,
          admin: unauthorizedAdmin.publicKey,
        })
        .signers([unauthorizedAdmin, vaultPosition.nftMint])
        .rpc();
      assert.fail("Ожидалась ошибка Unauthorized");
    } catch (error) {
      expect(String(error)).to.include("Unauthorized");
    }

    const wrongPoolPosition = await positionAccounts(
      wrongPairPoolId,
      vaultState,
      vaultTokenAccount,
      vaultTokenAccountB
    );
    try {
      await program.methods
        .openPosition(
          wrongPoolPosition.tickLower,
          wrongPoolPosition.tickUpper,
          wrongPoolPosition.tickArrayLowerStart,
          wrongPoolPosition.tickArrayUpperStart,
          wrongPoolPosition.amount0,
          wrongPoolPosition.amount1,
          wrongPoolPosition.base0
        )
        .accountsPartial(wrongPoolPosition.accounts)
        .signers([wrongPoolPosition.nftMint])
        .rpc();
      assert.fail("Ожидалась ошибка WrongPool");
    } catch (error) {
      expect(String(error)).to.include("WrongPool");
    }

    await program.methods
      .openPosition(
        vaultPosition.tickLower,
        vaultPosition.tickUpper,
        vaultPosition.tickArrayLowerStart,
        vaultPosition.tickArrayUpperStart,
        vaultPosition.amount0,
        vaultPosition.amount1,
        vaultPosition.base0
      )
      .accountsPartial(vaultPosition.accounts)
      .signers([vaultPosition.nftMint])
      .rpc();

    const state = await program.account.vaultState.fetch(vaultState);
    expect(state.positionOpen).to.equal(true);
    expect(state.inMarket).to.equal(true);
    expect(Math.pow(1.0001, vaultPosition.tickLower)).to.be.within(0.8, 0.81);
    expect(Math.pow(1.0001, vaultPosition.tickUpper)).to.be.within(1.24, 1.25);
    expect(state.positionNftMint.toBase58()).to.equal(
      vaultPosition.nftMint.publicKey.toBase58()
    );
    expect(state.personalPosition.toBase58()).to.equal(
      vaultPosition.accounts.personalPosition.toBase58()
    );
    expect(
      (await getAccount(provider.connection, vaultTokenAccount)).delegate
    ).to.equal(null);
    expect(
      (await getAccount(provider.connection, vaultTokenAccountB)).delegate
    ).to.equal(null);

    try {
      await program.methods
        .openPosition(
          vaultPosition.tickLower,
          vaultPosition.tickUpper,
          vaultPosition.tickArrayLowerStart,
          vaultPosition.tickArrayUpperStart,
          vaultPosition.amount0,
          vaultPosition.amount1,
          vaultPosition.base0
        )
        .accountsPartial(vaultPosition.accounts)
        .signers([vaultPosition.nftMint])
        .rpc();
      assert.fail("Ожидалась ошибка PositionAlreadyOpen");
    } catch (error) {
      expect(String(error)).to.include("PositionAlreadyOpen");
    }
  });

  it("collect_fees и close_position: только админ; сбор сохраняет ликвидность", async () => {
    const actionAccounts = positionActionAccounts(
      vaultPosition,
      admin.publicKey
    );
    try {
      await program.methods
        .collectFees()
        .accountsPartial({
          ...actionAccounts,
          admin: unauthorizedAdmin.publicKey,
        })
        .signers([unauthorizedAdmin])
        .rpc();
      assert.fail("Ожидалась ошибка Unauthorized");
    } catch (error) {
      expect(String(error)).to.include("Unauthorized");
    }
    try {
      await program.methods
        .closePosition(new anchor.BN(0), new anchor.BN(0))
        .accountsPartial({
          ...actionAccounts,
          admin: unauthorizedAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorizedAdmin])
        .rpc();
      assert.fail("Ожидалась ошибка Unauthorized");
    } catch (error) {
      expect(String(error)).to.include("Unauthorized");
    }

    const foreignPosition = await raydium.clmm.openPositionFromBase({
      poolInfo: vaultPosition.pool.poolInfo,
      poolKeys: vaultPosition.pool.poolKeys,
      ownerInfo: { useSOLBalance: false },
      tickLower: vaultPosition.tickLower,
      tickUpper: vaultPosition.tickUpper,
      base: "MintA",
      baseAmount: new BN(10_000_000),
      otherAmountMax: new BN(10_000_000),
      withMetadata: "no-create",
    });
    await foreignPosition.execute({ sendAndConfirm: true });
    const foreignNftMint = foreignPosition.extInfo.nftMint;
    try {
      await program.methods
        .collectFees()
        .accountsPartial({
          ...actionAccounts,
          positionNftMint: foreignNftMint,
          nftAccount: getAssociatedTokenAddressSync(
            foreignNftMint,
            admin.publicKey
          ),
          personalPosition: getPdaPersonalPositionAddress(
            CLMM_PROGRAM_ID,
            foreignNftMint
          ).publicKey,
        })
        .rpc();
      assert.fail("Ожидалась ошибка NoOpenPosition для чужой позиции");
    } catch (error) {
      expect(String(error)).to.include("NoOpenPosition");
    }

    const positionDataBeforeCollect = (
      await provider.connection.getAccountInfo(
        vaultPosition.accounts.personalPosition
      )
    )?.data;
    expect(positionDataBeforeCollect).to.exist;
    const liquidityBeforeCollect = positionDataBeforeCollect!.subarray(81, 97);
    const totalBeforeTrade =
      (await getTokenAccountAmount(vaultTokenAccount)) +
      (await getTokenAccountAmount(vaultTokenAccountB));
    await tradePool(tokenMintA, new BN(100_000_000));

    await program.methods.collectFees().accountsPartial(actionAccounts).rpc();
    const totalAfterCollect =
      (await getTokenAccountAmount(vaultTokenAccount)) +
      (await getTokenAccountAmount(vaultTokenAccountB));
    expect(totalAfterCollect).to.be.greaterThan(totalBeforeTrade);
    const liquidityAfterCollect = (
      await provider.connection.getAccountInfo(
        vaultPosition.accounts.personalPosition
      )
    )?.data;
    expect(
      liquidityAfterCollect?.subarray(81, 97).equals(liquidityBeforeCollect)
    ).to.equal(true);

    const vaultABeforeClose = await getTokenAccountAmount(vaultTokenAccount);
    const vaultBBeforeClose = await getTokenAccountAmount(vaultTokenAccountB);
    const adminLamportsBefore = await provider.connection.getBalance(
      admin.publicKey
    );
    await program.methods
      .closePosition(new anchor.BN(0), new anchor.BN(0))
      .accountsPartial({
        ...actionAccounts,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultState);
    expect(state.positionOpen).to.equal(false);
    expect(state.positionNftMint.equals(PublicKey.default)).to.equal(true);
    expect(
      await provider.connection.getAccountInfo(
        vaultPosition.accounts.personalPosition
      )
    ).to.equal(null);
    expect(await getTokenAccountAmount(vaultTokenAccount)).to.be.greaterThan(
      vaultABeforeClose
    );
    expect(await getTokenAccountAmount(vaultTokenAccountB)).to.be.greaterThan(
      vaultBBeforeClose
    );
    expect(
      await provider.connection.getBalance(admin.publicKey)
    ).to.be.greaterThan(adminLamportsBefore);
  });

  it("deposit и withdraw приостанавливаются, пока средства в рынке", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(1))
        .accountsPartial({
          user: user.publicKey,
          vaultState,
          userCard,
          userTokenAccount: userTokenAccountA,
          vaultTokenAccount,
          shareMint,
          userShareAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      assert.fail("Ожидалась ошибка InMarket при deposit");
    } catch (error) {
      expect(String(error)).to.include("InMarket");
    }

    try {
      await program.methods
        .withdraw(new anchor.BN(1))
        .accountsPartial({
          user: user.publicKey,
          vaultState,
          userCard,
          userTokenAccount: userTokenAccountA,
          vaultTokenAccount,
          shareMint,
          userShareAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
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
        .accountsPartial({
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
        .accountsPartial({
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
        .accountsPartial({
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

    const reverseQuote = await poolAccounts(
      pairPoolId,
      tokenMintB,
      tokenMintA,
      true,
      vaultTokenAccountB,
      vaultTokenAccount,
      new BN((await getTokenAccountAmount(vaultTokenAccountB)) + 1_000_000)
    );
    await splTransfer(
      provider.connection,
      payer,
      adminTokenAccountB,
      vaultTokenAccountB,
      admin.publicKey,
      1_000_000
    );
    const syncInstruction = await program.methods
      .syncVault()
      .accountsPartial({
        admin: admin.publicKey,
        vaultState,
        vaultTokenAccount,
        vaultTokenAccountB,
      })
      .instruction();
    await program.methods
      .swap(U64_MAX, new anchor.BN(1), false)
      .accountsPartial({
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

  it("withdraw: пользователь выводит все shares и получает весь TOKEN_A", async () => {
    const shares = await getAccount(provider.connection, userShareAccount);
    const vaultBalance = await getTokenAccountAmount(vaultTokenAccount);
    const userBalanceBefore = await getTokenAccountAmount(userTokenAccountA);
    await program.methods
      .withdraw(new anchor.BN(shares.amount.toString()))
      .accountsPartial({
        user: user.publicKey,
        vaultState,
        userCard,
        userTokenAccount: userTokenAccountA,
        vaultTokenAccount,
        shareMint,
        userShareAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    expect(await getTokenAccountAmount(vaultTokenAccount)).to.equal(0);
    expect(await getTokenAccountAmount(userTokenAccountA)).to.equal(
      userBalanceBefore + vaultBalance
    );
    const state = await program.account.vaultState.fetch(vaultState);
    expect(state.totalShares.toNumber()).to.equal(0);
    expect(state.totalTokens.toNumber()).to.equal(0);
  });

  it("второй vault открывает позицию без swap и синхронизируется после закрытия", async () => {
    [vault2State] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMintB.toBuffer()],
      program.programId
    );
    [vault2TokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMintB.toBuffer()],
      program.programId
    );
    [vault2TokenAccountB] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens_b"), tokenMintB.toBuffer()],
      program.programId
    );
    [vault2ShareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMintB.toBuffer()],
      program.programId
    );

    await program.methods
      .initializeVault()
      .accountsPartial({
        admin: admin.publicKey,
        tokenMint: tokenMintB,
        vaultState: vault2State,
        vaultTokenAccount: vault2TokenAccount,
        shareMint: vault2ShareMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    await program.methods
      .addPairToken()
      .accountsPartial({
        admin: admin.publicKey,
        vaultState: vault2State,
        tokenMintB: tokenMintA,
        vaultTokenAccountB: vault2TokenAccountB,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await splTransfer(
      provider.connection,
      payer,
      adminTokenAccountB,
      vault2TokenAccount,
      admin.publicKey,
      100_000_000
    );
    await splTransfer(
      provider.connection,
      payer,
      adminTokenAccountA,
      vault2TokenAccountB,
      admin.publicKey,
      100_000_000
    );

    const vault2Position = await positionAccounts(
      pairPoolId,
      vault2State,
      vault2TokenAccount,
      vault2TokenAccountB,
      tokenMintB,
      tokenMintA
    );
    await program.methods
      .openPosition(
        vault2Position.tickLower,
        vault2Position.tickUpper,
        vault2Position.tickArrayLowerStart,
        vault2Position.tickArrayUpperStart,
        vault2Position.amount0,
        vault2Position.amount1,
        vault2Position.base0
      )
      .accountsPartial(vault2Position.accounts)
      .signers([vault2Position.nftMint])
      .rpc();
    let vault2 = await program.account.vaultState.fetch(vault2State);
    expect(vault2.inMarket).to.equal(true);
    expect(vault2.positionOpen).to.equal(true);

    const syncInstruction = await program.methods
      .syncVault()
      .accountsPartial({
        admin: admin.publicKey,
        vaultState: vault2State,
        vaultTokenAccount: vault2TokenAccount,
        vaultTokenAccountB: vault2TokenAccountB,
      })
      .instruction();
    const balanceBeforeSync = await getTokenAccountAmount(vault2TokenAccountB);
    if (balanceBeforeSync > 0) {
      const swapAccounts = await poolAccounts(
        pairPoolId,
        tokenMintA,
        tokenMintB,
        true,
        vault2TokenAccountB,
        vault2TokenAccount,
        new BN(balanceBeforeSync)
      );
      await program.methods
        .swap(U64_MAX, new anchor.BN(1), false)
        .accountsPartial({
          admin: admin.publicKey,
          vaultState: vault2State,
          ...swapAccounts.accounts,
        })
        .remainingAccounts(swapAccounts.remainingAccounts)
        .postInstructions([syncInstruction])
        .rpc();
    }
    try {
      await program.methods
        .syncVault()
        .accountsPartial({
          admin: admin.publicKey,
          vaultState: vault2State,
          vaultTokenAccount: vault2TokenAccount,
          vaultTokenAccountB: vault2TokenAccountB,
        })
        .rpc();
      assert.fail("Ожидалась ошибка PositionOpen");
    } catch (error) {
      expect(String(error)).to.include("PositionOpen");
    }

    const actionAccounts = positionActionAccounts(
      vault2Position,
      admin.publicKey
    );
    await program.methods
      .closePosition(new anchor.BN(0), new anchor.BN(0))
      .accountsPartial({
        ...actionAccounts,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const balanceB = await getTokenAccountAmount(vault2TokenAccountB);
    if (balanceB > 0) {
      const finalQuote = await poolAccounts(
        pairPoolId,
        tokenMintA,
        tokenMintB,
        true,
        vault2TokenAccountB,
        vault2TokenAccount,
        new BN(balanceB)
      );
      await program.methods
        .swap(U64_MAX, new anchor.BN(1), false)
        .accountsPartial({
          admin: admin.publicKey,
          vaultState: vault2State,
          ...finalQuote.accounts,
        })
        .remainingAccounts(finalQuote.remainingAccounts)
        .rpc();
    }
    await program.methods
      .syncVault()
      .accountsPartial({
        admin: admin.publicKey,
        vaultState: vault2State,
        vaultTokenAccount: vault2TokenAccount,
        vaultTokenAccountB: vault2TokenAccountB,
      })
      .rpc();
    vault2 = await program.account.vaultState.fetch(vault2State);
    expect(vault2.positionOpen).to.equal(false);
    expect(vault2.inMarket).to.equal(false);
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
