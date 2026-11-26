pub mod constants;
pub mod error;
pub mod instructions;
pub mod raydium;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("HBdEu7TNtdBnR5sLzczBpeMJddzcxxEfVtaqYn1CjyKp");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault::handler(ctx)
    }

    pub fn create_user_card(ctx: Context<CreateUserCard>) -> Result<()> {
        instructions::create_user_card::handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, shares_amount)
    }

    pub fn add_pair_token(ctx: Context<AddPairToken>) -> Result<()> {
        instructions::add_pair_token::handler(ctx)
    }

    pub fn swap<'info>(
        ctx: Context<'_, '_, '_, 'info, Swap<'info>>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        instructions::swap::handler(ctx, amount_in, min_amount_out, a_to_b)
    }

    pub fn sync_vault(ctx: Context<SyncVault>) -> Result<()> {
        instructions::sync_vault::handler(ctx)
    }
}
