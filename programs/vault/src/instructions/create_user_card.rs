use anchor_lang::prelude::*;

use crate::state::{UserCard, VaultState};

#[derive(Accounts)]
pub struct CreateUserCard<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = user,
        space = 8 + UserCard::INIT_SPACE,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_card: Account<'info, UserCard>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateUserCard>) -> Result<()> {
    let user_card = &mut ctx.accounts.user_card;
    user_card.vault = ctx.accounts.vault_state.key();
    user_card.owner = ctx.accounts.user.key();
    user_card.deposited = 0;
    user_card.shares = 0;
    user_card.bump = ctx.bumps.user_card;
    Ok(())
}
