use anchor_lang::prelude::*;
use anchor_spl::memo::Memo;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use raydium_clmm_cpi::program::RaydiumClmm;
use raydium_clmm_cpi::states::{AmmConfig, ObservationState, PoolState};

use crate::error::VaultError;
use crate::raydium::swap_v2_cpi;
use crate::state::VaultState;

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = admin @ VaultError::Unauthorized,
        constraint = vault_state.token_mint_b != Pubkey::default() @ VaultError::PairTokenNotAdded,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub clmm_program: Program<'info, RaydiumClmm>,

    #[account(address = pool_state.load()?.amm_config)]
    pub amm_config: Box<Account<'info, AmmConfig>>,

    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,

    #[account(mut)]
    pub input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub output_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub input_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub output_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = pool_state.load()?.observation_key)]
    pub observation_state: AccountLoader<'info, ObservationState>,

    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub memo_program: Program<'info, Memo>,

    #[account(address = input_vault.mint)]
    pub input_vault_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(address = output_vault.mint)]
    pub output_vault_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, Swap<'info>>,
    amount_in: u64,
    min_amount_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let vault_state = &ctx.accounts.vault_state;

    let (expected_input_acc, expected_output_acc, input_mint, output_mint) = if a_to_b {
        (
            vault_state.vault_token_account,
            vault_state.vault_token_account_b,
            vault_state.token_mint,
            vault_state.token_mint_b,
        )
    } else {
        (
            vault_state.vault_token_account_b,
            vault_state.vault_token_account,
            vault_state.token_mint_b,
            vault_state.token_mint,
        )
    };

    require_keys_eq!(
        ctx.accounts.input_token_account.key(),
        expected_input_acc,
        VaultError::WrongPool
    );
    require_keys_eq!(
        ctx.accounts.output_token_account.key(),
        expected_output_acc,
        VaultError::WrongPool
    );
    require_keys_eq!(
        ctx.accounts.input_vault_mint.key(),
        input_mint,
        VaultError::WrongPool
    );
    require_keys_eq!(
        ctx.accounts.output_vault_mint.key(),
        output_mint,
        VaultError::WrongPool
    );

    // Check that the pool is specifically for (TOKEN_A, TOKEN_B) and vaults are not swapped
    {
        let pool = ctx.accounts.pool_state.load()?;
        let (expected_in_vault, expected_out_vault) =
            if pool.token_mint_0 == input_mint && pool.token_mint_1 == output_mint {
                (pool.token_vault_0, pool.token_vault_1)
            } else if pool.token_mint_1 == input_mint && pool.token_mint_0 == output_mint {
                (pool.token_vault_1, pool.token_vault_0)
            } else {
                return Err(VaultError::WrongPool.into());
            };

        require_keys_eq!(
            ctx.accounts.input_vault.key(),
            expected_in_vault,
            VaultError::WrongPool
        );
        require_keys_eq!(
            ctx.accounts.output_vault.key(),
            expected_out_vault,
            VaultError::WrongPool
        );
    }

    // amount_in == u64::MAX means swap entire balance of input token
    let actual_amount_in = if amount_in == u64::MAX {
        ctx.accounts.input_token_account.amount
    } else {
        amount_in
    };

    if actual_amount_in == 0 {
        return Err(VaultError::ZeroAmount.into());
    }

    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

    swap_v2_cpi(
        ctx.accounts.clmm_program.to_account_info(),
        ctx.accounts.vault_state.to_account_info(),
        ctx.accounts.amm_config.to_account_info(),
        ctx.accounts.pool_state.to_account_info(),
        ctx.accounts.input_token_account.to_account_info(),
        ctx.accounts.output_token_account.to_account_info(),
        ctx.accounts.input_vault.to_account_info(),
        ctx.accounts.output_vault.to_account_info(),
        ctx.accounts.observation_state.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.token_program_2022.to_account_info(),
        ctx.accounts.memo_program.to_account_info(),
        ctx.accounts.input_vault_mint.to_account_info(),
        ctx.accounts.output_vault_mint.to_account_info(),
        ctx.remaining_accounts,
        signer_seeds,
        actual_amount_in,
        min_amount_out,
        0,
        true,
    )?;

    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.in_market = true;

    Ok(())
}
