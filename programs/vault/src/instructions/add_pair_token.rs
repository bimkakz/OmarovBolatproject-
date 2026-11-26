use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::VaultError;
use crate::state::VaultState;

#[derive(Accounts)]
pub struct AddPairToken<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = admin @ VaultError::Unauthorized,
        constraint = vault_state.token_mint_b == Pubkey::default() @ VaultError::PairTokenAlreadyAdded,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        constraint = token_mint_b.key() != vault_state.token_mint @ VaultError::WrongPool,
    )]
    pub token_mint_b: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault_tokens_b", vault_state.token_mint.as_ref()],
        bump,
        token::mint = token_mint_b,
        token::authority = vault_state,
    )]
    pub vault_token_account_b: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<AddPairToken>) -> Result<()> {
    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.token_mint_b = ctx.accounts.token_mint_b.key();
    vault_state.vault_token_account_b = ctx.accounts.vault_token_account_b.key();
    Ok(())
}
