use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::VaultState;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = admin,
        seeds = [b"vault_tokens", token_mint.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        seeds = [b"share_mint", token_mint.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<InitializeVault>) -> Result<()> {
    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.admin = ctx.accounts.admin.key();
    vault_state.token_mint = ctx.accounts.token_mint.key();
    vault_state.vault_token_account = ctx.accounts.vault_token_account.key();
    vault_state.share_mint = ctx.accounts.share_mint.key();
    vault_state.total_tokens = 0;
    vault_state.total_shares = 0;
    vault_state.bump = ctx.bumps.vault_state;
    Ok(())
}
