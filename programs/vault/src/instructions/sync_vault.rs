use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::error::VaultError;
use crate::state::VaultState;

#[derive(Accounts)]
pub struct SyncVault<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = admin @ VaultError::Unauthorized,
        has_one = vault_token_account,
        has_one = vault_token_account_b,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub vault_token_account: Account<'info, TokenAccount>,
    pub vault_token_account_b: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<SyncVault>) -> Result<()> {
    require!(
        !ctx.accounts.vault_state.position_open,
        VaultError::PositionOpen
    );
    require!(
        ctx.accounts.vault_token_account_b.amount == 0,
        VaultError::TokenBNotZero
    );

    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.total_tokens = ctx.accounts.vault_token_account.amount;
    vault_state.in_market = false;

    Ok(())
}
