pub mod error;
pub mod instructions;
pub mod raydium;
pub mod state;

use anchor_lang::prelude::*;

pub use error::*;
pub use instructions::*;
pub(crate) use raydium::{
    __client_accounts_close_position, __client_accounts_collect_fees,
    __client_accounts_open_position,
};
pub use raydium::{ClosePosition, CollectFees, OpenPosition};
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

    pub fn open_position(
        ctx: Context<OpenPosition>,
        tick_lower: i32,
        tick_upper: i32,
        tick_array_lower_start: i32,
        tick_array_upper_start: i32,
        amount_0_max: u64,
        amount_1_max: u64,
        base_0: bool,
    ) -> Result<()> {
        raydium::open_position_handler(
            ctx,
            tick_lower,
            tick_upper,
            tick_array_lower_start,
            tick_array_upper_start,
            amount_0_max,
            amount_1_max,
            base_0,
        )
    }

    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        raydium::collect_fees_handler(ctx)
    }

    pub fn close_position(
        ctx: Context<ClosePosition>,
        amount_0_min: u64,
        amount_1_min: u64,
    ) -> Result<()> {
        raydium::close_position_handler(ctx, amount_0_min, amount_1_min)
    }
}
