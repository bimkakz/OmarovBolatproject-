use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::error::VaultError;
use crate::state::{UserCard, VaultState};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
        has_one = vault_token_account,
        has_one = share_mint,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
        constraint = user_card.vault == vault_state.key(),
        constraint = user_card.owner == user.key(),
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(
        mut,
        constraint = user_token_account.mint == vault_state.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_share_account.mint == share_mint.key(),
        constraint = user_share_account.owner == user.key(),
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.vault_state.in_market, VaultError::InMarket);

    if amount == 0 {
        return Err(VaultError::ZeroAmount.into());
    }

    let vault_state = &ctx.accounts.vault_state;

    // Calculate shares:
    // First deposit (total_shares == 0 or total_tokens == 0): shares = amount (1:1)
    // Later: shares = amount * total_shares / total_tokens
    let shares = if vault_state.total_shares == 0 || vault_state.total_tokens == 0 {
        amount
    } else {
        let shares_u128 = (amount as u128)
            .checked_mul(vault_state.total_shares as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(vault_state.total_tokens as u128)
            .ok_or(VaultError::MathOverflow)?;
        u64::try_from(shares_u128).map_err(|_| VaultError::MathOverflow)?
    };

    if shares == 0 {
        return Err(VaultError::SharesTooSmall.into());
    }

    // Transfer user tokens to vault_token_account
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    // Mint share tokens to user_share_account (signed by vault_state PDA)
    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", token_mint_key.as_ref(), &[bump]]];

    let mint_to_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.share_mint.to_account_info(),
            to: ctx.accounts.user_share_account.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        },
        signer_seeds,
    );
    token::mint_to(mint_to_ctx, shares)?;

    // Update total_tokens and total_shares in VaultState
    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.total_tokens = vault_state
        .total_tokens
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;
    vault_state.total_shares = vault_state
        .total_shares
        .checked_add(shares)
        .ok_or(VaultError::MathOverflow)?;

    // Update deposited and shares in UserCard
    let user_card = &mut ctx.accounts.user_card;
    user_card.deposited = user_card
        .deposited
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;
    user_card.shares = user_card
        .shares
        .checked_add(shares)
        .ok_or(VaultError::MathOverflow)?;

    Ok(())
}
