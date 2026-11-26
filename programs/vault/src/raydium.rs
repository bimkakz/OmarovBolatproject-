use crate::error::VaultError;
use crate::state::VaultState;
use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::metadata::Metadata;
use anchor_spl::token::{self, Approve, Revoke, Token, TokenAccount};
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount as InterfaceTokenAccount};
use raydium_clmm_cpi::cpi::accounts::SwapSingleV2;
use raydium_clmm_cpi::cpi::accounts::{
    ClosePosition as ClosePositionCpi, DecreaseLiquidityV2 as DecreaseLiquidityV2Cpi,
    OpenPositionV2 as OpenPositionV2Cpi,
};
use raydium_clmm_cpi::program::RaydiumClmm;
use raydium_clmm_cpi::states::{PersonalPositionState, PoolState, TickArrayState};

#[allow(clippy::too_many_arguments)]
pub fn swap_v2_cpi<'a, 'b, 'c, 'info>(
    clmm_program: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    amm_config: AccountInfo<'info>,
    pool_state: AccountInfo<'info>,
    input_token_account: AccountInfo<'info>,
    output_token_account: AccountInfo<'info>,
    input_vault: AccountInfo<'info>,
    output_vault: AccountInfo<'info>,
    observation_state: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    token_program_2022: AccountInfo<'info>,
    memo_program: AccountInfo<'info>,
    input_vault_mint: AccountInfo<'info>,
    output_vault_mint: AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit_x64: u128,
    is_base_input: bool,
) -> Result<()> {
    let cpi_accounts = SwapSingleV2 {
        payer,
        amm_config,
        pool_state,
        input_token_account,
        output_token_account,
        input_vault,
        output_vault,
        observation_state,
        token_program,
        token_program_2022,
        memo_program,
        input_vault_mint,
        output_vault_mint,
    };

    let cpi_ctx = CpiContext::new_with_signer(clmm_program, cpi_accounts, signer_seeds)
        .with_remaining_accounts(remaining_accounts.to_vec());

    raydium_clmm_cpi::cpi::swap_v2(
        cpi_ctx,
        amount,
        other_amount_threshold,
        sqrt_price_limit_x64,
        is_base_input,
    )
}

#[derive(Accounts)]
#[instruction(tick_lower: i32, tick_upper: i32, tick_array_lower_start: i32, tick_array_upper_start: i32)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = admin @ VaultError::Unauthorized,
        constraint = vault_state.token_mint_b != Pubkey::default() @ VaultError::PairTokenNotAdded,
        constraint = !vault_state.position_open @ VaultError::PositionAlreadyOpen,
        constraint = vault_token_account_a.key() == vault_state.vault_token_account,
        has_one = vault_token_account_b,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub clmm_program: Program<'info, RaydiumClmm>,

    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,

    /// CHECK: Raydium initializes this mint using the supplied signer.
    #[account(mut)]
    pub position_nft_mint: Signer<'info>,

    /// CHECK: Raydium initializes the associated NFT account for the vault PDA.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,

    /// CHECK: Raydium derives and validates the metadata PDA.
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    /// CHECK: Raydium validates the protocol position.
    pub protocol_position: UncheckedAccount<'info>,

    /// CHECK: PDA is validated by Raydium's CPI account constraints.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,

    /// CHECK: PDA is validated by Raydium's CPI account constraints.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: Raydium initializes this PDA for the position NFT mint.
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,

    #[account(mut)]
    pub vault_token_account_a: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account_b: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_vault_0: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,

    #[account(mut)]
    pub token_vault_1: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
    pub token_program_2022: Program<'info, Token2022>,

    #[account(address = token_vault_0.mint)]
    pub vault_0_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = token_vault_1.mint)]
    pub vault_1_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn open_position_handler<'info>(
    ctx: Context<OpenPosition>,
    tick_lower: i32,
    tick_upper: i32,
    tick_array_lower_start: i32,
    tick_array_upper_start: i32,
    amount_0_max: u64,
    amount_1_max: u64,
    base_0: bool,
) -> Result<()> {
    let vault = &ctx.accounts.vault_state;
    let (mint_0, mint_1, account_0, account_1) = {
        let pool = ctx.accounts.pool_state.load()?;
        if pool.token_mint_0 == vault.token_mint && pool.token_mint_1 == vault.token_mint_b {
            (
                vault.token_mint,
                vault.token_mint_b,
                ctx.accounts.vault_token_account_a.to_account_info(),
                ctx.accounts.vault_token_account_b.to_account_info(),
            )
        } else if pool.token_mint_0 == vault.token_mint_b && pool.token_mint_1 == vault.token_mint {
            (
                vault.token_mint_b,
                vault.token_mint,
                ctx.accounts.vault_token_account_b.to_account_info(),
                ctx.accounts.vault_token_account_a.to_account_info(),
            )
        } else {
            return Err(VaultError::WrongPool.into());
        }
    };

    let (vault_0, vault_1) = {
        let pool = ctx.accounts.pool_state.load()?;
        (pool.token_vault_0, pool.token_vault_1)
    };
    require_keys_eq!(
        ctx.accounts.token_vault_0.key(),
        vault_0,
        VaultError::WrongPool
    );
    require_keys_eq!(
        ctx.accounts.token_vault_1.key(),
        vault_1,
        VaultError::WrongPool
    );
    require_keys_eq!(
        ctx.accounts.vault_0_mint.key(),
        mint_0,
        VaultError::WrongPool
    );
    require_keys_eq!(
        ctx.accounts.vault_1_mint.key(),
        mint_1,
        VaultError::WrongPool
    );

    require_keys_eq!(
        ctx.accounts.vault_token_account_a.mint,
        vault.token_mint,
        VaultError::WrongPool
    );
    require_keys_eq!(
        ctx.accounts.vault_token_account_b.mint,
        vault.token_mint_b,
        VaultError::WrongPool
    );
    let mint_key = vault.token_mint;
    let bump = vault.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", mint_key.as_ref(), &[bump]]];

    token::approve(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Approve {
                to: account_0.clone(),
                delegate: ctx.accounts.admin.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        ),
        amount_0_max,
    )?;
    token::approve(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Approve {
                to: account_1.clone(),
                delegate: ctx.accounts.admin.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        ),
        amount_1_max,
    )?;

    let cpi_accounts = OpenPositionV2Cpi {
        payer: ctx.accounts.admin.to_account_info(),
        position_nft_owner: ctx.accounts.vault_state.to_account_info(),
        position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
        metadata_account: ctx.accounts.metadata_account.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        protocol_position: ctx.accounts.protocol_position.to_account_info(),
        tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
        tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        token_account_0: account_0,
        token_account_1: account_1,
        token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
        token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        metadata_program: ctx.accounts.metadata_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        vault_0_mint: ctx.accounts.vault_0_mint.to_account_info(),
        vault_1_mint: ctx.accounts.vault_1_mint.to_account_info(),
    };
    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.clmm_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    raydium_clmm_cpi::cpi::open_position_v2(
        cpi_context,
        tick_lower,
        tick_upper,
        tick_array_lower_start,
        tick_array_upper_start,
        0,
        amount_0_max,
        amount_1_max,
        false,
        Some(base_0),
    )?;

    token::revoke(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Revoke {
            source: ctx.accounts.vault_token_account_a.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        },
        signer_seeds,
    ))?;
    token::revoke(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Revoke {
            source: ctx.accounts.vault_token_account_b.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        },
        signer_seeds,
    ))?;

    let vault = &mut ctx.accounts.vault_state;
    vault.position_open = true;
    vault.position_nft_mint = ctx.accounts.position_nft_mint.key();
    vault.personal_position = ctx.accounts.personal_position.key();
    vault.in_market = true;
    Ok(())
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = admin @ VaultError::Unauthorized,
        constraint = vault_state.position_open @ VaultError::NoOpenPosition,
        constraint = vault_token_account_a.key() == vault_state.vault_token_account,
        has_one = vault_token_account_b,
        constraint = position_nft_mint.key() == vault_state.position_nft_mint @ VaultError::NoOpenPosition,
        constraint = personal_position.key() == vault_state.personal_position @ VaultError::NoOpenPosition,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub position_nft_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, constraint = nft_account.mint == position_nft_mint.key() @ VaultError::NoOpenPosition,
        constraint = nft_account.owner == vault_state.key() @ VaultError::NoOpenPosition,
        constraint = nft_account.amount == 1 @ VaultError::NoOpenPosition)]
    pub nft_account: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub personal_position: Box<Account<'info, PersonalPositionState>>,
    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,
    /// CHECK: Raydium uses this legacy protocol position account.
    pub protocol_position: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_vault_0: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub token_vault_1: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub tick_array_lower: AccountLoader<'info, TickArrayState>,
    #[account(mut)]
    pub tick_array_upper: AccountLoader<'info, TickArrayState>,
    #[account(mut)]
    pub vault_token_account_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account_b: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub memo_program: Program<'info, Memo>,
    #[account(address = token_vault_0.mint)]
    pub vault_0_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = token_vault_1.mint)]
    pub vault_1_mint: Box<InterfaceAccount<'info, Mint>>,
    pub clmm_program: Program<'info, RaydiumClmm>,
}

pub fn collect_fees_handler(ctx: Context<CollectFees>) -> Result<()> {
    validate_position_pool(
        &ctx.accounts.vault_state,
        &ctx.accounts.personal_position,
        &ctx.accounts.pool_state,
        &ctx.accounts.token_vault_0,
        &ctx.accounts.token_vault_1,
        &ctx.accounts.vault_0_mint,
        &ctx.accounts.vault_1_mint,
    )?;
    decrease_position_liquidity(
        ctx.accounts.clmm_program.to_account_info(),
        ctx.accounts.vault_state.to_account_info(),
        ctx.accounts.nft_account.to_account_info(),
        ctx.accounts.personal_position.to_account_info(),
        ctx.accounts.pool_state.to_account_info(),
        ctx.accounts.protocol_position.to_account_info(),
        ctx.accounts.token_vault_0.to_account_info(),
        ctx.accounts.token_vault_1.to_account_info(),
        ctx.accounts.tick_array_lower.to_account_info(),
        ctx.accounts.tick_array_upper.to_account_info(),
        ctx.accounts.vault_token_account_a.to_account_info(),
        ctx.accounts.vault_token_account_b.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.token_program_2022.to_account_info(),
        ctx.accounts.memo_program.to_account_info(),
        ctx.accounts.vault_0_mint.to_account_info(),
        ctx.accounts.vault_1_mint.to_account_info(),
        ctx.accounts.vault_state.bump,
        0,
        0,
        0,
    )
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = admin @ VaultError::Unauthorized,
        constraint = vault_state.position_open @ VaultError::NoOpenPosition,
        constraint = vault_token_account_a.key() == vault_state.vault_token_account,
        has_one = vault_token_account_b,
        constraint = position_nft_mint.key() == vault_state.position_nft_mint @ VaultError::NoOpenPosition,
        constraint = personal_position.key() == vault_state.personal_position @ VaultError::NoOpenPosition,
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(mut)]
    pub position_nft_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, constraint = nft_account.mint == position_nft_mint.key() @ VaultError::NoOpenPosition,
        constraint = nft_account.owner == vault_state.key() @ VaultError::NoOpenPosition,
        constraint = nft_account.amount == 1 @ VaultError::NoOpenPosition)]
    pub nft_account: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub personal_position: Box<Account<'info, PersonalPositionState>>,
    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,
    /// CHECK: Raydium uses this legacy protocol position account.
    pub protocol_position: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_vault_0: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub token_vault_1: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub tick_array_lower: AccountLoader<'info, TickArrayState>,
    #[account(mut)]
    pub tick_array_upper: AccountLoader<'info, TickArrayState>,
    #[account(mut)]
    pub vault_token_account_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account_b: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub memo_program: Program<'info, Memo>,
    #[account(address = token_vault_0.mint)]
    pub vault_0_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = token_vault_1.mint)]
    pub vault_1_mint: Box<InterfaceAccount<'info, Mint>>,
    pub clmm_program: Program<'info, RaydiumClmm>,
    pub system_program: Program<'info, System>,
}

pub fn close_position_handler(
    ctx: Context<ClosePosition>,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    validate_position_pool(
        &ctx.accounts.vault_state,
        &ctx.accounts.personal_position,
        &ctx.accounts.pool_state,
        &ctx.accounts.token_vault_0,
        &ctx.accounts.token_vault_1,
        &ctx.accounts.vault_0_mint,
        &ctx.accounts.vault_1_mint,
    )?;
    let liquidity = ctx.accounts.personal_position.liquidity;
    decrease_position_liquidity(
        ctx.accounts.clmm_program.to_account_info(),
        ctx.accounts.vault_state.to_account_info(),
        ctx.accounts.nft_account.to_account_info(),
        ctx.accounts.personal_position.to_account_info(),
        ctx.accounts.pool_state.to_account_info(),
        ctx.accounts.protocol_position.to_account_info(),
        ctx.accounts.token_vault_0.to_account_info(),
        ctx.accounts.token_vault_1.to_account_info(),
        ctx.accounts.tick_array_lower.to_account_info(),
        ctx.accounts.tick_array_upper.to_account_info(),
        ctx.accounts.vault_token_account_a.to_account_info(),
        ctx.accounts.vault_token_account_b.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.token_program_2022.to_account_info(),
        ctx.accounts.memo_program.to_account_info(),
        ctx.accounts.vault_0_mint.to_account_info(),
        ctx.accounts.vault_1_mint.to_account_info(),
        ctx.accounts.vault_state.bump,
        liquidity,
        amount_0_min,
        amount_1_min,
    )?;

    let mint_key = ctx.accounts.vault_state.token_mint;
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", mint_key.as_ref(), &[bump]]];
    let close_accounts = ClosePositionCpi {
        nft_owner: ctx.accounts.vault_state.to_account_info(),
        position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
        position_nft_account: ctx.accounts.nft_account.to_account_info(),
        personal_position: ctx.accounts.personal_position.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    raydium_clmm_cpi::cpi::close_position(CpiContext::new_with_signer(
        ctx.accounts.clmm_program.to_account_info(),
        close_accounts,
        signer_seeds,
    ))?;

    let vault_info = ctx.accounts.vault_state.to_account_info();
    let rent_floor = Rent::get()?.minimum_balance(vault_info.data_len());
    let refund = vault_info.lamports().saturating_sub(rent_floor);
    if refund > 0 {
        ctx.accounts.vault_state.sub_lamports(refund)?;
        ctx.accounts.admin.add_lamports(refund)?;
    }

    let vault = &mut ctx.accounts.vault_state;
    vault.position_open = false;
    vault.position_nft_mint = Pubkey::default();
    vault.personal_position = Pubkey::default();
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn decrease_position_liquidity<'info>(
    clmm_program: AccountInfo<'info>,
    vault_state: AccountInfo<'info>,
    nft_account: AccountInfo<'info>,
    personal_position: AccountInfo<'info>,
    pool_state: AccountInfo<'info>,
    protocol_position: AccountInfo<'info>,
    token_vault_0: AccountInfo<'info>,
    token_vault_1: AccountInfo<'info>,
    tick_array_lower: AccountInfo<'info>,
    tick_array_upper: AccountInfo<'info>,
    vault_token_account_a: AccountInfo<'info>,
    vault_token_account_b: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    token_program_2022: AccountInfo<'info>,
    memo_program: AccountInfo<'info>,
    vault_0_mint: AccountInfo<'info>,
    vault_1_mint: AccountInfo<'info>,
    bump: u8,
    liquidity: u128,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    let vault_data = VaultState::try_deserialize(&mut &vault_state.try_borrow_data()?[..])?;
    let mint_key = vault_data.token_mint;
    let (recipient_0, recipient_1) = if vault_data.token_mint == *vault_0_mint.key {
        (vault_token_account_a, vault_token_account_b)
    } else {
        (vault_token_account_b, vault_token_account_a)
    };
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", mint_key.as_ref(), &[bump]]];
    let accounts = DecreaseLiquidityV2Cpi {
        nft_owner: vault_state,
        nft_account,
        personal_position,
        pool_state,
        protocol_position,
        token_vault_0,
        token_vault_1,
        tick_array_lower,
        tick_array_upper,
        recipient_token_account_0: recipient_0,
        recipient_token_account_1: recipient_1,
        token_program,
        token_program_2022,
        memo_program,
        vault_0_mint,
        vault_1_mint,
    };
    raydium_clmm_cpi::cpi::decrease_liquidity_v2(
        CpiContext::new_with_signer(clmm_program, accounts, signer_seeds),
        liquidity,
        amount_0_min,
        amount_1_min,
    )
}

fn validate_position_pool<'info>(
    vault: &Account<'info, VaultState>,
    personal_position: &Account<'info, PersonalPositionState>,
    pool_state: &AccountLoader<'info, PoolState>,
    token_vault_0: &InterfaceAccount<'info, InterfaceTokenAccount>,
    token_vault_1: &InterfaceAccount<'info, InterfaceTokenAccount>,
    mint_0: &InterfaceAccount<'info, Mint>,
    mint_1: &InterfaceAccount<'info, Mint>,
) -> Result<()> {
    require_keys_eq!(
        personal_position.nft_mint,
        vault.position_nft_mint,
        VaultError::NoOpenPosition
    );
    require_keys_eq!(
        personal_position.key(),
        vault.personal_position,
        VaultError::NoOpenPosition
    );
    let pool = pool_state.load()?;
    require_keys_eq!(
        personal_position.pool_id,
        pool_state.key(),
        VaultError::WrongPool
    );
    let correct_pair = (pool.token_mint_0 == vault.token_mint
        && pool.token_mint_1 == vault.token_mint_b)
        || (pool.token_mint_0 == vault.token_mint_b && pool.token_mint_1 == vault.token_mint);
    require!(correct_pair, VaultError::WrongPool);
    require_keys_eq!(
        token_vault_0.key(),
        pool.token_vault_0,
        VaultError::WrongPool
    );
    require_keys_eq!(
        token_vault_1.key(),
        pool.token_vault_1,
        VaultError::WrongPool
    );
    require_keys_eq!(mint_0.key(), pool.token_mint_0, VaultError::WrongPool);
    require_keys_eq!(mint_1.key(), pool.token_mint_1, VaultError::WrongPool);
    Ok(())
}
