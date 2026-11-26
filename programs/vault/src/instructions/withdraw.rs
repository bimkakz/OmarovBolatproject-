//! Инструкция withdraw
//!
//! Что такое CPI (Cross-Program Invocation):
//! CPI — это вызов одной программы Solana из другой во время выполнения транзакции.
//! Программа формирует инструкцию для внешней программы (например, Token Program)
//! и передает исполнение среде выполнения Solana (runtime), которая проверяет права
//! и выполняет логику целевой программы.
//!
//! Почему PDA без приватного ключа подписывает через seeds:
//! У PDA (Program Derived Address) нет соответствующего приватного ключа (точка лежит вне эллиптической кривой ed25519).
//! Вместо криптографической подписи приватным ключом, среда выполнения Solana (Solana Runtime)
//! проверяет, что вызывающая программа является истинным владельцем (program_id) данного PDA.
//! Программа передает seeds и bump через CpiContext::new_with_signer. Если хэш от seeds + bump + program_id
//! совпадает с публичным ключом PDA, среда выполнения автоматически повышает флаг `is_signer = true`
//! для этого PDA в целевой CPI инструкции.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::error::VaultError;
use crate::state::{UserCard, VaultState};

#[derive(Accounts)]
pub struct Withdraw<'info> {
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

pub fn handler(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
    if shares_amount == 0 {
        return Err(VaultError::ZeroAmount.into());
    }

    let vault_state = &ctx.accounts.vault_state;
    if vault_state.total_shares == 0 {
        return Err(VaultError::VaultEmpty.into());
    }

    // tokens = shares_amount * total_tokens / total_shares
    let tokens = (shares_amount as u128)
        .checked_mul(vault_state.total_tokens as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(vault_state.total_shares as u128)
        .ok_or(VaultError::MathOverflow)? as u64;

    if tokens == 0 {
        return Err(VaultError::WithdrawTooSmall.into());
    }

    // 1. CPI Token program: burn share-токенов пользователя (подписывает сам пользователь)
    let burn_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: ctx.accounts.share_mint.to_account_info(),
            from: ctx.accounts.user_share_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::burn(burn_ctx, shares_amount)?;

    // 2. CPI Token program: transfer токенов из vault_token_account пользователю
    // Подписывает vault_state PDA через CpiContext::new_with_signer и seeds
    let token_mint_key = ctx.accounts.vault_state.token_mint;
    let bump = ctx.accounts.vault_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"vault",
        token_mint_key.as_ref(),
        &[bump],
    ]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, tokens)?;

    // 3. Обновить total_tokens и total_shares в VaultState
    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.total_tokens = vault_state
        .total_tokens
        .checked_sub(tokens)
        .ok_or(VaultError::MathOverflow)?;
    vault_state.total_shares = vault_state
        .total_shares
        .checked_sub(shares_amount)
        .ok_or(VaultError::MathOverflow)?;

    // 4. Обновить поля карточки (deposited и shares)
    let user_card = &mut ctx.accounts.user_card;
    user_card.shares = user_card
        .shares
        .checked_sub(shares_amount)
        .ok_or(VaultError::InsufficientCardShares)?;
    // deposited уменьшаем пропорционально выведенным токенам (не ниже 0)
    user_card.deposited = user_card.deposited.saturating_sub(tokens);

    Ok(())
}
